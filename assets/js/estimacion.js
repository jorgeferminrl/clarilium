"use strict";

/* ==================================================================== *
 * Estimaciones · www.clarilium.com/portal/estimacion
 * Formulario que genera el PDF de estimacion de un requerimiento.
 * El acceso lo resuelve portal-auth.js, comun a todo /portal.
 * ==================================================================== */

// Requiere assets/js/portal-auth.js (sesion, Graph y porton comunes del portal).
const APP = {
  // Se pide aparte: si el permiso aun no esta concedido, la pagina sigue
  // funcionando y "Estimado por" muestra solo a quien inicio sesion.
  scopesUsuarios: ["User.ReadBasic.All"],
  listaClientes: "Clientes",
  formatoDefault: "CLARILIUM"
};

const unicos = arr => [...new Map(arr.map(v => String(v ?? "").trim()).filter(Boolean).map(v => [norm(v), v])).values()]
  .sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));

/* ------------------------------------------------------------------ *
 * Contenido fijo de la hoja
 * ------------------------------------------------------------------ */
const TAREAS = [
  { id: "hAnalisis", nombre: "Análisis", alta: true,
    resumen: ["Análisis de:", "• Especificación funcional", "• Script de pruebas", "• Objetos de desarrollo", "• Objetos de configuración", "", "Sesiones con cliente y/o con consultor funcional"] },
  { id: "hConstruccion", nombre: "Construcción",
    resumen: ["Construcción de objetos de desarrollo y/o configuración"] },
  { id: "hPruebas", nombre: "Pruebas Unitarias ABAP",
    resumen: ["Ejecución de las pruebas unitarias y generación de las evidencias de las pruebas"] },
  { id: "hDocumentacion", nombre: "Documentación",
    resumen: ["Actualización de Especificación Técnica, Documento de Soporte o Análisis de Causas"] },
  { id: "hCalidad", nombre: "Control de Calidad", alta: true,
    resumen: ["Revisión de la calidad del código:", "• Estándares de programación", "• Mejores prácticas", "• Rendimiento (Performance)", "", "Revisión de la calidad de documentación a entregar"] }
];

// Colores de cada formato para el PDF (los de pantalla estan en estimacion.css).
const TEMAS = {
  clarilium: { logo: "clarilium", oscuro: "#040814", oscuroTexto: "#FFFFFF", seccion: "#9A36FF", seccionTexto: "#FFFFFF",
               tarea: "#0C193E", resumen: "#667085", borde: "#C9CCD4", marco: "#040814", acento: "#2493ED", total: "#B469FF", italica: false },
  dxgrow:    { logo: "dxgrow", oscuro: "#1E1E1E", oscuroTexto: "#FFFFFF", seccion: "#A6A6A6", seccionTexto: "#FFFFFF",
               tarea: "#7F7F7F", resumen: "#8C8C8C", borde: "#1E1E1E", marco: "#1E1E1E", acento: null, total: "#FFFFFF", italica: true }
};
// Solo Dxgrow tiene formato propio; cualquier otro cliente usa el de CLARILIUM.
const temaDe = formato => norm(formato).includes("dxgrow") ? "dxgrow" : "clarilium";

/* ------------------------------------------------------------------ *
 * Datos: clientes (lista Clientes) y usuarios del tenant
 * ------------------------------------------------------------------ */
async function leerClientes(token) {
  const g = PORTAL.graph;
  const sitio = await graphGet(`${g.base}/sites/${g.hostname}:${g.sitePath}?$select=id`, token);
  const listas = await graphTodo(`${g.base}/sites/${sitio.id}/lists?$select=id,name,displayName&$top=200`, token);
  const lista = listas.find(l => norm(l.displayName) === norm(APP.listaClientes) || norm(l.name) === norm(APP.listaClientes));
  if (!lista) throw new Error(`Falta la lista “${APP.listaClientes}” en el sitio de SharePoint.`);
  const columnas = await graphTodo(`${g.base}/sites/${sitio.id}/lists/${lista.id}/columns?$select=name,displayName&$top=200`, token);
  const interno = visible => (columnas.find(c => norm(c.displayName) === norm(visible)) || columnas.find(c => norm(c.name) === norm(visible)))?.name;
  const colCliente = interno("Cliente");
  const colSub = interno("Subcliente");
  if (!colSub) throw new Error("La lista Clientes no tiene la columna “Subcliente”.");
  const items = await graphTodo(`${g.base}/sites/${sitio.id}/lists/${lista.id}/items?$expand=fields&$top=500`, token);
  const texto = v => (v && typeof v === "object") ? (v.LookupValue ?? v.lookupValue ?? v.Label ?? "") : v;
  return {
    subclientes: unicos(items.map(i => texto(i.fields?.[colSub]))),
    clientes: colCliente ? unicos(items.map(i => texto(i.fields?.[colCliente]))) : []
  };
}

async function leerUsuarios() {
  const token = await auth.token(APP.scopesUsuarios, false);
  const url = `${PORTAL.graph.base}/users?$select=displayName,userPrincipalName&$top=999`;
  const usuarios = await graphTodo(url, token);
  return unicos(usuarios
    .filter(u => { const p = norm(u.userPrincipalName); return p.endsWith(PORTAL.dominio) && !p.includes("#ext#"); })
    .map(u => u.displayName));
}

const DEMO = {
  yo: "Usuario Demo",
  subclientes: ["Mobility ADO", "Cliente Ejemplo Norte", "Cliente Ejemplo Sur"],
  clientes: ["Dxgrow", "CLARILIUM", "Cliente Ejemplo"],
  usuarios: ["Usuario Demo", "Consultor Ejemplo Uno", "Consultor Ejemplo Dos"]
};

/* ------------------------------------------------------------------ *
 * Llenado de listas y formato
 * ------------------------------------------------------------------ */
function llenarSelect(select, valores, { vacio = true, elegido = "" } = {}) {
  select.replaceChildren();
  if (vacio) select.append(new Option("Selecciona…", ""));
  valores.forEach(v => select.append(new Option(v, v)));
  if (elegido) select.value = elegido;
}

function llenarFormatos(clientes) {
  const otros = clientes.filter(c => norm(c) !== norm(APP.formatoDefault));
  llenarSelect($("formato"), [APP.formatoDefault, ...otros], { vacio: false, elegido: APP.formatoDefault });
  aplicarFormato();
}

function aplicarFormato() {
  const tema = temaDe($("formato").value);
  document.body.classList.toggle("fmt-dxgrow", tema === "dxgrow");
  document.body.classList.toggle("fmt-clarilium", tema === "clarilium");
  const logo = window.ESTIMACION_LOGOS?.[TEMAS[tema].logo];
  const img = $("logoFormato");
  if (logo) img.src = logo.src;
  img.alt = tema === "dxgrow" ? "Dxgrow" : "CLARILIUM";
}

function estado(texto, error = false) {
  const el = $("estadoCarga");
  el.textContent = texto || "";
  el.classList.toggle("estado--error", error);
}

/* ------------------------------------------------------------------ *
 * Captura y validacion
 * ------------------------------------------------------------------ */
const RE_ID = /^[1-9]\d{0,9}$/;
const RE_HORAS = /^(0|[1-9]\d{0,3})(\.\d)?$/;

// ID: solo digitos, sin ceros a la izquierda, hasta 10.
function limpiarId(v) { return v.replace(/\D/g, "").replace(/^0+/, "").slice(0, 10); }

// Horas: hasta 4 enteros sin ceros a la izquierda y un decimal.
function limpiarHoras(v) {
  let s = v.replace(/,/g, ".").replace(/[^\d.]/g, "");
  const punto = s.indexOf(".");
  let ent = punto < 0 ? s : s.slice(0, punto);
  const dec = punto < 0 ? "" : s.slice(punto + 1).replace(/\./g, "").slice(0, 1);
  ent = ent.replace(/^0+(?=\d)/, "").slice(0, 4);
  if (punto < 0) return ent;
  return `${ent || "0"}.${dec}`;
}

function reemplazarValor(input, nuevo) {
  if (input.value === nuevo) return;
  const quitados = input.value.length - nuevo.length;
  const pos = Math.max(0, (input.selectionStart ?? nuevo.length) - Math.max(0, quitados));
  input.value = nuevo;
  try { input.setSelectionRange(pos, pos); } catch { /* sin cursor */ }
}

const decimas = v => RE_HORAS.test(v) ? Math.round(parseFloat(v) * 10) : 0;
const fmtHoras = d => (d / 10).toFixed(1);

function actualizarTotal() {
  const total = TAREAS.reduce((s, t) => s + decimas($(t.id).value), 0);
  $("total").value = fmtHoras(total);
  $("total").textContent = fmtHoras(total);
}

function leerFormulario() {
  const horas = {};
  TAREAS.forEach(t => { horas[t.id] = decimas($(t.id).value); });
  return {
    formato: $("formato").value,
    id: $("idReq").value.trim(),
    descripcion: $("descripcion").value.trim(),
    cliente: $("cliente").value,
    estimadoPor: $("estimadoPor").value,
    horas,
    total: Object.values(horas).reduce((a, b) => a + b, 0)
  };
}

function validar() {
  const errores = [];
  const marcar = (id, ok, texto) => { $(id).classList.toggle("invalido", !ok); if (!ok) errores.push(texto); };
  const d = leerFormulario();
  marcar("idReq", RE_ID.test(d.id), d.id ? "ID Requerimiento debe ser un número entero de hasta 10 dígitos, sin ceros a la izquierda." : "ID Requerimiento es obligatorio.");
  marcar("descripcion", d.descripcion.length > 0 && d.descripcion.length <= 75, d.descripcion ? "Descripción admite hasta 75 caracteres." : "Descripción es obligatoria.");
  marcar("cliente", Boolean(d.cliente), "Cliente es obligatorio.");
  marcar("estimadoPor", Boolean(d.estimadoPor), "Estimado por es obligatorio.");
  TAREAS.forEach(t => {
    const v = $(t.id).value;
    marcar(t.id, v === "" || RE_HORAS.test(v), `${t.nombre}: hasta 4 enteros sin ceros a la izquierda y un decimal.`);
  });
  const caja = $("errores");
  if (errores.length) {
    caja.replaceChildren(document.createTextNode("Revisa los campos marcados:"));
    const ul = document.createElement("ul");
    errores.forEach(e => { const li = document.createElement("li"); li.textContent = e; ul.append(li); });
    caja.append(ul);
    caja.hidden = false;
    document.querySelector(".invalido")?.focus();
    return null;
  }
  caja.hidden = true;
  return d;
}

/* ------------------------------------------------------------------ *
 * PDF
 * ------------------------------------------------------------------ */
function nombreArchivo(d) {
  const limpio = s => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return `${limpio(`EST - ${d.cliente} - ${d.id} - ${d.descripcion}`)}.pdf`;
}

function generarPDF(d) {
  if (!window.jspdf?.jsPDF) throw new Error("No se pudo cargar la biblioteca para crear el PDF. Recarga la página.");
  const T = TEMAS[temaDe(d.formato)];
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "letter", orientation: "portrait" });
  const est = base => T.italica ? (base === "normal" ? "italic" : "bolditalic") : base;
  const X = 12, W = doc.internal.pageSize.getWidth() - 24;
  const c1 = W * 0.25, c2 = W * 0.30, c3 = W - c1 - c2;
  let y = 14;

  const celda = (x, yy, w, h, relleno, borde = T.borde) => {
    doc.setDrawColor(borde); doc.setLineWidth(0.25);
    if (relleno) { doc.setFillColor(relleno); doc.rect(x, yy, w, h, "FD"); } else doc.rect(x, yy, w, h, "S");
  };
  const texto = (t, x, yy, { tam = 9, estilo = "normal", color = "#000000", alinear = "left" } = {}) => {
    doc.setFont("helvetica", est(estilo)); doc.setFontSize(tam); doc.setTextColor(color);
    doc.text(t, x, yy, { align: alinear, baseline: "middle" });
  };

  // Encabezado con logo y titulo
  const hEnc = 26;
  celda(X, y, W, hEnc, T.oscuro, T.oscuro);
  const logo = window.ESTIMACION_LOGOS?.[T.logo];
  let anchoLogo = 0;
  if (logo) {
    const alto = T.logo === "dxgrow" ? 21 : 9.5;
    anchoLogo = alto * logo.ancho / logo.alto;
    doc.addImage(logo.src, "PNG", X + 5, y + (hEnc - alto) / 2, anchoLogo, alto);
  }
  const inicioTitulo = X + 5 + anchoLogo + 4;
  texto("Estimación de construcción del requerimiento", inicioTitulo + (X + W - inicioTitulo) / 2, y + hEnc / 2,
        { tam: 16, estilo: "bold", color: T.oscuroTexto, alinear: "center" });
  y += hEnc;
  if (T.acento) { doc.setFillColor(T.acento); doc.rect(X, y, W, 1, "F"); y += 1; }

  // Datos del requerimiento: etiqueta | valor | etiqueta | valor
  const a1 = W * 0.25, a2 = W * 0.27, a3 = W * 0.13, a4 = W - a1 - a2 - a3;
  const filaDatos = (et1, v1, et2, v2) => {
    doc.setFont("helvetica", est("normal")); doc.setFontSize(9);
    const l1 = doc.splitTextToSize(v1, a2 - 4), l2 = doc.splitTextToSize(v2, a4 - 4);
    const h = Math.max(7, Math.max(l1.length, l2.length) * 3.8 + 3.2);
    celda(X, y, a1, h, T.oscuro); celda(X + a1 + a2, y, a3, h, T.oscuro);
    celda(X + a1, y, a2, h, "#FFFFFF"); celda(X + a1 + a2 + a3, y, a4, h, "#FFFFFF");
    texto(et1, X + a1 - 2.5, y + h / 2, { estilo: "bold", color: T.oscuroTexto, alinear: "right" });
    texto(et2, X + a1 + a2 + a3 - 2.5, y + h / 2, { estilo: "bold", color: T.oscuroTexto, alinear: "right" });
    const centrado = (lineas, cx) => lineas.forEach((l, i) => texto(l, cx, y + h / 2 + (i - (lineas.length - 1) / 2) * 3.8, { alinear: "center" }));
    centrado(l1, X + a1 + a2 / 2); centrado(l2, X + a1 + a2 + a3 + a4 / 2);
    y += h;
  };
  filaDatos("ID Requerimiento:", d.id, "Descripción", d.descripcion);
  filaDatos("Cliente", d.cliente, "Estimado por", d.estimadoPor);

  // Encabezado de la tabla
  const hCab = 7;
  [[X, c1, "Tareas / Entregables"], [X + c1, c2, "Resumen de la funcionalidad"], [X + c1 + c2, c3, "Esfuerzo ( Horas )"]].forEach(([x, w, t]) => {
    celda(x, y, w, hCab, T.oscuro);
    texto(t, x + w / 2, y + hCab / 2, { tam: 9.5, estilo: "bold", color: T.oscuroTexto, alinear: "center" });
  });
  y += hCab;

  // Seccion
  const hSec = 6.5;
  celda(X, y, c1 + c2, hSec, T.seccion); celda(X + c1 + c2, y, c3, hSec, T.seccion);
  texto("Análisis y Estimación ABAP", X + 2.5, y + hSec / 2, { tam: 9.5, estilo: "bold", color: T.seccionTexto });
  y += hSec;

  // Tareas
  TAREAS.forEach(t => {
    doc.setFont("helvetica", est("normal")); doc.setFontSize(8);
    const lineas = t.resumen.flatMap(l => l ? doc.splitTextToSize(l, c2 - 5) : [""]);
    const h = Math.max(t.alta ? 34 : 11, lineas.length * 3.5 + 4);
    celda(X, y, c1, h); celda(X + c1, y, c2, h); celda(X + c1 + c2, y, c3, h);
    doc.setFont("helvetica", est("bold")); doc.setFontSize(9);
    const nombre = doc.splitTextToSize(t.nombre, c1 - 10);
    nombre.forEach((l, i) => texto(l, X + 6, y + h / 2 + (i - (nombre.length - 1) / 2) * 4, { estilo: "bold", color: T.tarea }));
    lineas.forEach((l, i) => l && texto(l, X + c1 + 2.5, y + 3.8 + i * 3.5, { tam: 8, color: T.resumen }));
    texto(fmtHoras(d.horas[t.id]), X + W - 3, y + h - 3, { tam: 10, estilo: "bold", color: "#000000", alinear: "right" });
    y += h;
  });

  // Total
  const hTot = 7.5;
  celda(X, y, c1 + c2, hTot, T.oscuro); celda(X + c1 + c2, y, c3, hTot, T.oscuro);
  texto("Total del esfuerzo:", X + c1 + c2 - 3, y + hTot / 2, { tam: 10, estilo: "bold", color: T.oscuroTexto, alinear: "right" });
  texto(fmtHoras(d.total), X + W - 3, y + hTot / 2, { tam: 10.5, estilo: "bold", color: T.total, alinear: "right" });
  y += hTot;

  // Marco exterior
  doc.setDrawColor(T.marco); doc.setLineWidth(0.6); doc.rect(X, 14, W, y - 14, "S");

  doc.setProperties({ title: nombreArchivo(d).replace(/\.pdf$/, ""), subject: "Estimación de construcción del requerimiento",
                      author: d.estimadoPor, creator: "CLARILIUM · Estimaciones" });
  return doc.output("blob");
}

async function descargar() {
  const d = validar();
  if (!d) return;
  let blob;
  try { blob = generarPDF(d); } catch (error) { mostrarError(error.message); return; }
  const nombre = nombreArchivo(d);
  // Cuadro "Guardar como" con el nombre propuesto (Edge y Chrome).
  if (window.showSaveFilePicker) {
    try {
      const archivo = await window.showSaveFilePicker({
        suggestedName: nombre,
        types: [{ description: "Documento PDF", accept: { "application/pdf": [".pdf"] } }]
      });
      const escritor = await archivo.createWritable();
      await escritor.write(blob);
      await escritor.close();
      return;
    } catch (error) {
      if (error?.name === "AbortError") return;   // el usuario cancelo
    }
  }
  // Respaldo para navegadores sin ese cuadro: descarga con el mismo nombre.
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: nombre });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function mostrarError(texto) {
  const caja = $("errores");
  caja.textContent = texto;
  caja.hidden = false;
}

/* ------------------------------------------------------------------ *
 * Eventos
 * ------------------------------------------------------------------ */
function enlazar() {
  $("idReq").addEventListener("input", e => { reemplazarValor(e.target, limpiarId(e.target.value)); e.target.classList.remove("invalido"); });
  $("descripcion").addEventListener("input", e => e.target.classList.remove("invalido"));
  ["cliente", "estimadoPor"].forEach(id => $(id).addEventListener("change", e => e.target.classList.remove("invalido")));
  TAREAS.forEach(t => {
    const input = $(t.id);
    input.addEventListener("input", () => { reemplazarValor(input, limpiarHoras(input.value)); input.classList.remove("invalido"); actualizarTotal(); });
    input.addEventListener("blur", () => {
      if (input.value.endsWith(".")) input.value = input.value.slice(0, -1);
      if (RE_HORAS.test(input.value)) input.value = (parseFloat(input.value)).toFixed(1);
      actualizarTotal();
    });
  });
  const alCambiar = () => {
    if (!document.querySelector(".invalido")) $("errores").hidden = true;
  };
  $("forma").addEventListener("input", alCambiar);
  $("forma").addEventListener("change", alCambiar);
  $("forma").addEventListener("submit", e => e.preventDefault());
  $("formato").addEventListener("change", aplicarFormato);
  $("descargar").addEventListener("click", descargar);
}

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */
async function cargarDatosReales() {
  estado("Cargando clientes y usuarios…");
  const token = await auth.token();
  const yo = (await graphGet(`${PORTAL.graph.base}/me?$select=displayName`, token)).displayName || auth.account.name || "";
  $("cuentaNombre").textContent = yo;

  let usuarios = [yo];
  let aviso = "";
  try { usuarios = unicos([yo, ...(await leerUsuarios())]); }
  catch { aviso = "No se pudo leer el directorio de usuarios; “Estimado por” muestra solo tu nombre."; }
  llenarSelect($("estimadoPor"), usuarios, { elegido: yo });

  const { subclientes, clientes } = await leerClientes(token);
  llenarSelect($("cliente"), subclientes);
  llenarFormatos(clientes);
  estado(aviso, Boolean(aviso));
}

document.addEventListener("DOMContentLoaded", () => {
  enlazar();
  actualizarTotal();
  aplicarFormato();
  $("volver").href = enlacePortal("portal", "../");
  iniciarPortal({
    alDemo: () => {
      llenarSelect($("cliente"), DEMO.subclientes);
      llenarSelect($("estimadoPor"), DEMO.usuarios, { elegido: DEMO.yo });
      llenarFormatos(DEMO.clientes);
    },
    alEntrar: () => cargarDatosReales().catch(error => estado(error.message, true)),
    nombreDemo: DEMO.yo
  }).catch(error => {
    console.error("Estimaciones: fallo al iniciar", error);
    porton({ error: error.message || "Ocurrió un error inesperado.", reintentar: true });
  });
});
