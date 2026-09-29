"use strict";

/* ==================================================================== *
 * Facturacion · www.clarilium.com/portal/facturacion
 * Los colaboradores suben el XML (CFDI 4.0) y el PDF de su factura. La pagina
 * revisa que ambos archivos sean validos y que el PDF corresponda al XML, y
 * los envia a /api/facturacion. La funcion vuelve a revisar todo y manda el
 * correo a los destinatarios de SharePoint: esta pagina NUNCA conoce esas
 * direcciones ni el buzon que envia.
 * El acceso lo resuelve portal-auth.js, comun a todo /portal.
 * ==================================================================== */

const FAC = {
  api: "/api/facturacion",
  maxXml: 1024 * 1024,              // 1 MB
  maxPdf: 2 * 1024 * 1024,          // 2 MB
  maxTotal: Math.floor(2.5 * 1024 * 1024), // tope de Microsoft Graph para adjuntos en un solo envio
  paginasPdf: 10,                   // paginas del PDF que se leen para cruzar datos
  nsCfdi: "http://www.sat.gob.mx/cfd/4",
  nsCfdi33: "http://www.sat.gob.mx/cfd/3",
  nsTfd: "http://www.sat.gob.mx/TimbreFiscalDigital",
  limites: { nombre: 60, apellido: 60, tipoServicio: 120, contacto: 120 },
  pdfjs: ["../assets/js/vendor/pdf.worker.js", "../assets/js/vendor/pdf.js"]
};

const RE_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;
const RE_UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

const estado = {
  xml: null,   // { archivo, bytes, datos } cuando es valido
  pdf: null,   // { archivo, bytes, texto } cuando es valido
  errXml: null, errPdf: null,  // mensaje {es, en} si el archivo no es valido
  cruce: [],   // diferencias entre XML y PDF
  enviando: false,
  revisando: { xml: false, pdf: false },
  resultado: null  // mensaje general tras enviar
};

const m = (es, en) => ({ es, en });
const txm = msg => tx(msg.es, msg.en);

/* ------------------------------------------------------------------ *
 * Utilidades
 * ------------------------------------------------------------------ */
function leerBytes(archivo) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(new Uint8Array(r.result));
    r.onerror = () => no(r.error);
    r.readAsArrayBuffer(archivo);
  });
}

function aBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function extension(nombre) {
  const i = String(nombre).lastIndexOf(".");
  return i < 0 ? "" : String(nombre).slice(i + 1).toLowerCase();
}

function tamano(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Texto normalizado para buscar: mayusculas, sin acentos y sin espacios.
const plano = v => String(v ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "");

function limpiarTexto(v, max) {
  return String(v ?? "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

let pdfjsCargado = null;
function cargarPdfjs() {
  if (pdfjsCargado) return pdfjsCargado;
  const cargar = src => new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = ok;
    s.onerror = () => no(new Error(src));
    document.head.appendChild(s);
  });
  // Primero el "worker" (se ejecuta en la misma pagina) y luego la biblioteca.
  pdfjsCargado = FAC.pdfjs.reduce((p, src) => p.then(() => cargar(src)), Promise.resolve())
    .then(() => {
      if (!window.pdfjsLib || !window.pdfjsWorker) throw new Error("pdf.js");
      return window.pdfjsLib;
    })
    .catch(e => { pdfjsCargado = null; throw e; });
  return pdfjsCargado;
}

/* ------------------------------------------------------------------ *
 * XML: debe ser un CFDI 4.0 timbrado
 * ------------------------------------------------------------------ */
function analizarXml(bytes) {
  if (new TextDecoder("latin1").decode(bytes.subarray(0, 8)).startsWith("%PDF-")) throw m("El archivo es un PDF con extensión .xml; sube el XML de la factura.", "The file is a PDF with an .xml extension; upload the invoice XML.");
  let texto;
  try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw m("El XML no está codificado en UTF-8; no es un CFDI válido.", "The XML is not UTF-8 encoded; it is not a valid CFDI."); }
  texto = texto.replace(/^﻿/, "");
  if (!texto.trim().startsWith("<")) throw m("El archivo no es un XML.", "The file is not an XML document.");
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) throw m("El XML contiene declaraciones DOCTYPE/ENTITY; por seguridad no se acepta.", "The XML contains DOCTYPE/ENTITY declarations; it is rejected for security reasons.");

  const doc = new DOMParser().parseFromString(texto, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw m("El XML está dañado o incompleto (no es un XML bien formado).", "The XML is damaged or incomplete (not well-formed).");

  const raiz = doc.documentElement;
  if (raiz.localName !== "Comprobante") throw m("El XML no es un CFDI: falta el nodo Comprobante.", "The XML is not a CFDI: the Comprobante node is missing.");
  if (raiz.namespaceURI === FAC.nsCfdi33) throw m("El XML es un CFDI 3.3, que ya no está vigente. Sube la versión 4.0.", "The XML is a CFDI 3.3, which is no longer valid. Upload version 4.0.");
  if (raiz.namespaceURI !== FAC.nsCfdi || raiz.getAttribute("Version") !== "4.0") throw m("El XML no es un CFDI versión 4.0.", "The XML is not a CFDI version 4.0.");

  const hijo = nombre => [...raiz.children].find(n => n.namespaceURI === FAC.nsCfdi && n.localName === nombre);
  const emisor = hijo("Emisor");
  const receptor = hijo("Receptor");
  const tfd = doc.getElementsByTagNameNS(FAC.nsTfd, "TimbreFiscalDigital")[0];

  const datos = {
    serie: (raiz.getAttribute("Serie") || "").trim(),
    folio: (raiz.getAttribute("Folio") || "").trim(),
    fecha: raiz.getAttribute("Fecha") || "",
    total: raiz.getAttribute("Total") || "",
    moneda: raiz.getAttribute("Moneda") || "",
    emisorRfc: (emisor?.getAttribute("Rfc") || "").trim().toUpperCase(),
    emisorNombre: emisor?.getAttribute("Nombre") || "",
    receptorRfc: (receptor?.getAttribute("Rfc") || "").trim().toUpperCase(),
    uuid: (tfd?.getAttribute("UUID") || "").trim().toUpperCase()
  };

  const faltan = [];
  if (!emisor || !RE_RFC.test(datos.emisorRfc)) faltan.push(m("RFC del emisor", "issuer RFC"));
  if (!receptor || !RE_RFC.test(datos.receptorRfc)) faltan.push(m("RFC del receptor", "recipient RFC"));
  if (!/^\d+(\.\d+)?$/.test(datos.total)) faltan.push(m("total", "total"));
  if (faltan.length) throw m(`El CFDI no es válido: falta o está mal el ${faltan.map(f => f.es).join(", ")}.`, `The CFDI is not valid: the ${faltan.map(f => f.en).join(", ")} is missing or wrong.`);
  if (!tfd || !RE_UUID.test(datos.uuid)) throw m("El XML no está timbrado: falta el Timbre Fiscal Digital (UUID).", "The XML is not stamped: the Timbre Fiscal Digital (UUID) is missing.");
  return datos;
}

/* ------------------------------------------------------------------ *
 * PDF: debe abrir, no llevar contrasena ni codigo y tener texto
 * ------------------------------------------------------------------ */
async function analizarPdf(bytes) {
  const cabecera = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
  if (!cabecera.includes("%PDF-")) throw m("El archivo no es un PDF (le falta la firma %PDF).", "The file is not a PDF (the %PDF signature is missing).");

  let pdfjsLib;
  try { pdfjsLib = await cargarPdfjs(); }
  catch { throw m("No se pudo cargar el lector de PDF. Recarga la página e inténtalo de nuevo.", "The PDF reader could not be loaded. Reload the page and try again."); }

  let doc;
  try {
    doc = await pdfjsLib.getDocument({
      data: bytes.slice(),          // pdf.js se queda con el bufer; le damos una copia
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      disableAutoFetch: true,
      verbosity: 0
    }).promise;
  } catch (e) {
    if (e?.name === "PasswordException") throw m("El PDF está protegido con contraseña. Sube uno sin contraseña.", "The PDF is password-protected. Upload one without a password.");
    throw m("El PDF está dañado o no se puede abrir.", "The PDF is damaged or cannot be opened.");
  }

  try {
    if (!doc.numPages) throw m("El PDF no tiene páginas.", "The PDF has no pages.");
    if (await doc.getJSActions()) throw m("El PDF contiene código JavaScript; por seguridad no se acepta.", "The PDF contains JavaScript code; it is rejected for security reasons.");
    const partes = [];
    for (let n = 1; n <= Math.min(doc.numPages, FAC.paginasPdf); n++) {
      const pagina = await doc.getPage(n);
      const contenido = await pagina.getTextContent();
      partes.push(contenido.items.map(i => i.str || "").join(" "));
    }
    const texto = partes.join("\n");
    if (plano(texto).length < 20) throw m("El PDF no tiene texto seleccionable (parece una imagen escaneada). Sube la representación impresa que genera tu sistema de facturación.", "The PDF has no selectable text (it looks like a scanned image). Upload the printed representation generated by your invoicing system.");
    return texto;
  } catch (e) {
    if (e?.es) throw e;
    throw m("El PDF está dañado o no se puede leer.", "The PDF is damaged or cannot be read.");
  } finally {
    doc.destroy();
  }
}

/* ------------------------------------------------------------------ *
 * Cruce XML <-> PDF (la funcion de Azure repite exactamente estas reglas)
 * ------------------------------------------------------------------ */
function importes(texto) {
  // Une cifras que el PDF parte en pedazos ("11,600 .00") y extrae todos los numeros.
  const unido = texto.replace(/(\d)\s+([.,]\d)/g, "$1$2").replace(/(\d[.,])\s+(\d)/g, "$1$2");
  return (unido.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || []).map(v => Number(v.replace(/,/g, "")));
}

function formatoImporte(v) {
  return Number(v).toLocaleString(window.CLARILIUM ? window.CLARILIUM.locale() : "es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
}

function cruzar(d, textoPdf) {
  const p = plano(textoPdf);
  const errores = [];
  const uuid = plano(d.uuid);
  if (!p.includes(uuid) && !p.replace(/-/g, "").includes(uuid.replace(/-/g, "")))
    errores.push(m(`El PDF no contiene el folio fiscal (UUID) ${d.uuid} del XML.`, `The PDF does not contain the fiscal folio (UUID) ${d.uuid} from the XML.`));
  if (!p.includes(plano(d.emisorRfc)))
    errores.push(m(`El PDF no contiene el RFC del emisor ${d.emisorRfc} del XML.`, `The PDF does not contain the issuer RFC ${d.emisorRfc} from the XML.`));
  if (!p.includes(plano(d.receptorRfc)))
    errores.push(m(`El PDF no contiene el RFC del receptor ${d.receptorRfc} del XML.`, `The PDF does not contain the recipient RFC ${d.receptorRfc} from the XML.`));
  const total = Number(d.total);
  if (!importes(textoPdf).some(v => Math.abs(v - total) < 0.005))
    errores.push(m(`El PDF no muestra el total ${formatoImporte(total)} del XML.`, `The PDF does not show the total ${formatoImporte(total)} from the XML.`));
  if (d.folio && !p.includes(plano(d.folio)))
    errores.push(m(`El PDF no contiene el folio ${d.serie}${d.folio} del XML.`, `The PDF does not contain the folio ${d.serie}${d.folio} from the XML.`));
  else if (d.serie && !p.includes(plano(d.serie)))
    errores.push(m(`El PDF no contiene la serie ${d.serie} del XML.`, `The PDF does not contain the series ${d.serie} from the XML.`));
  return errores;
}

/* ------------------------------------------------------------------ *
 * Zonas de carga
 * ------------------------------------------------------------------ */
const ZONAS = {
  xml: { input: "archivoXml", zona: "zonaXml", ext: "xml", max: FAC.maxXml },
  pdf: { input: "archivoPdf", zona: "zonaPdf", ext: "pdf", max: FAC.maxPdf }
};
let turno = { xml: 0, pdf: 0 };   // evita que una lectura vieja pise a una nueva

function pintarZona(tipo, clase, textoEstado) {
  const z = $(ZONAS[tipo].zona);
  const archivo = tipo === "xml" ? (estado.xml?.archivo || z._archivo) : (estado.pdf?.archivo || z._archivo);
  z.classList.remove("zona--ok", "zona--error", "zona--revisando");
  if (clase) z.classList.add(clase);
  const hay = Boolean(archivo);
  z.querySelector(".zona__texto").hidden = hay;
  z.querySelector(".zona__ayuda").hidden = hay;
  z.querySelector(".zona__archivo").hidden = !hay;
  z.querySelector(".zona__nombre").textContent = hay ? `${archivo.name} · ${tamano(archivo.size)}` : "";
  z.querySelector(".zona__estado").textContent = textoEstado || "";
  document.querySelector(`[data-quitar="${tipo}"]`).hidden = !hay;
}

function repintarZonas() {
  for (const tipo of ["xml", "pdf"]) {
    if (estado.revisando[tipo]) { pintarZona(tipo, "zona--revisando", tx("Revisando…", "Checking…")); continue; }
    const err = tipo === "xml" ? estado.errXml : estado.errPdf;
    const ok = tipo === "xml" ? estado.xml : estado.pdf;
    if (err) pintarZona(tipo, "zona--error", txm(err));
    else if (ok) pintarZona(tipo, estado.cruce.length ? "zona--error" : "zona--ok",
      estado.cruce.length ? tx("No coincide con el otro archivo", "Does not match the other file")
        : (estado.xml && estado.pdf ? tx("Válido · coincide con el otro archivo", "Valid · matches the other file") : tx("Archivo válido", "Valid file")));
    else pintarZona(tipo, "", "");
  }
}

async function recibirArchivo(tipo, archivo) {
  const cfg = ZONAS[tipo];
  const mio = ++turno[tipo];
  estado.resultado = null;
  estado[tipo] = null;
  estado[tipo === "xml" ? "errXml" : "errPdf"] = null;
  estado.cruce = [];
  $(cfg.zona)._archivo = archivo || null;
  estado.revisando[tipo] = false;

  if (!archivo) { repintarZonas(); mostrarMensajes(); return; }

  const fallar = msg => {
    if (mio !== turno[tipo]) return;
    estado.revisando[tipo] = false;
    estado[tipo === "xml" ? "errXml" : "errPdf"] = msg;
    repintarZonas(); mostrarMensajes();
  };

  if (extension(archivo.name) !== cfg.ext)
    return fallar(tipo === "xml" ? m("Solo se aceptan archivos con extensión .xml.", "Only files with the .xml extension are accepted.")
                                 : m("Solo se aceptan archivos con extensión .pdf.", "Only files with the .pdf extension are accepted."));
  if (!archivo.size) return fallar(m("El archivo está vacío.", "The file is empty."));
  if (archivo.size > cfg.max) return fallar(m(`El archivo pesa ${tamano(archivo.size)}; el máximo es ${tamano(cfg.max)}.`, `The file is ${tamano(archivo.size)}; the maximum is ${tamano(cfg.max)}.`));

  estado.revisando[tipo] = true;
  repintarZonas();
  mostrarMensajes();
  try {
    const bytes = await leerBytes(archivo);
    if (tipo === "xml") {
      const datos = analizarXml(bytes);
      if (mio !== turno[tipo]) return;
      estado.xml = { archivo, bytes, datos };
    } else {
      const texto = await analizarPdf(bytes);
      if (mio !== turno[tipo]) return;
      estado.pdf = { archivo, bytes, texto };
    }
  } catch (e) {
    return fallar(e?.es ? e : m("No se pudo leer el archivo.", "The file could not be read."));
  }
  estado.revisando[tipo] = false;
  if (estado.xml && estado.pdf) estado.cruce = cruzar(estado.xml.datos, estado.pdf.texto);
  repintarZonas();
  mostrarMensajes();
}

function prepararZona(tipo) {
  const cfg = ZONAS[tipo];
  const input = $(cfg.input);
  const zona = $(cfg.zona);
  input.addEventListener("change", () => recibirArchivo(tipo, input.files[0] || null));
  ["dragenter", "dragover"].forEach(ev => zona.addEventListener(ev, e => { e.preventDefault(); zona.classList.add("zona--encima"); }));
  ["dragleave", "dragend"].forEach(ev => zona.addEventListener(ev, () => zona.classList.remove("zona--encima")));
  zona.addEventListener("drop", e => {
    e.preventDefault();
    zona.classList.remove("zona--encima");
    const archivos = e.dataTransfer?.files;
    if (!archivos?.length) return;
    input.value = "";
    recibirArchivo(tipo, archivos[0]);
  });
  document.querySelector(`[data-quitar="${tipo}"]`).addEventListener("click", () => { input.value = ""; recibirArchivo(tipo, null); });
}

// Soltar un archivo fuera de las zonas no debe abrirlo en la pestana.
["dragover", "drop"].forEach(ev => window.addEventListener(ev, e => { if (!e.target.closest?.(".zona")) e.preventDefault(); }));

/* ------------------------------------------------------------------ *
 * Mensajes
 * ------------------------------------------------------------------ */
let erroresCampos = [];

function mostrarMensajes() {
  const caja = $("mensajes");
  caja.className = "fac__mensajes";
  caja.replaceChildren();

  if (estado.resultado) {
    caja.classList.add(`fac__mensajes--${estado.resultado.tipo}`);
    const p = document.createElement("p");
    p.textContent = txm(estado.resultado.titulo);
    caja.appendChild(p);
    if (estado.resultado.lista?.length) caja.appendChild(lista(estado.resultado.lista));
    caja.hidden = false;
    return;
  }

  const errores = [...erroresCampos];
  if (estado.errXml) errores.push(m(`XML: ${estado.errXml.es}`, `XML: ${estado.errXml.en}`));
  if (estado.errPdf) errores.push(m(`PDF: ${estado.errPdf.es}`, `PDF: ${estado.errPdf.en}`));
  errores.push(...estado.cruce);
  if (!errores.length) { caja.hidden = true; return; }

  caja.classList.add("fac__mensajes--error");
  const p = document.createElement("p");
  p.textContent = estado.cruce.length && !erroresCampos.length && !estado.errXml && !estado.errPdf
    ? tx("El PDF no corresponde al XML:", "The PDF does not match the XML:")
    : tx("Revisa lo siguiente:", "Please check the following:");
  caja.appendChild(p);
  caja.appendChild(lista(errores));
  caja.hidden = false;
}

function lista(mensajes) {
  const ul = document.createElement("ul");
  mensajes.forEach(msg => { const li = document.createElement("li"); li.textContent = txm(msg); ul.appendChild(li); });
  return ul;
}

/* ------------------------------------------------------------------ *
 * Envio
 * ------------------------------------------------------------------ */
const CAMPOS = [
  { id: "nombre", nombre: m("Nombre", "First name") },
  { id: "apellido", nombre: m("Apellido", "Last name") },
  { id: "tipoServicio", nombre: m("Tipo de servicio", "Type of service") },
  { id: "contacto", nombre: m("Contacto que solicitó el servicio", "Contact who requested the service") }
];

function revisarCampos() {
  erroresCampos = [];
  const valores = {};
  CAMPOS.forEach(c => {
    const el = $(c.id);
    const v = limpiarTexto(el.value, FAC.limites[c.id]);
    valores[c.id] = v;
    const malo = !v;
    el.setAttribute("aria-invalid", malo ? "true" : "false");
    if (malo) erroresCampos.push(m(`Falta capturar «${c.nombre.es}».`, `“${c.nombre.en}” is required.`));
  });
  if (!estado.xml && !estado.errXml) erroresCampos.push(m("Falta cargar el archivo XML.", "The XML file is missing."));
  if (!estado.pdf && !estado.errPdf) erroresCampos.push(m("Falta cargar el archivo PDF.", "The PDF file is missing."));
  if (estado.xml && estado.pdf && estado.xml.bytes.length + estado.pdf.bytes.length > FAC.maxTotal)
    erroresCampos.push(m(`Entre los dos archivos pesan más de ${tamano(FAC.maxTotal)}; reduce el tamaño del PDF.`, `Together the two files exceed ${tamano(FAC.maxTotal)}; reduce the PDF size.`));
  return valores;
}

// Token de identificacion (ID token) vigente de la cuenta con sesion.
// La funcion de Azure lo verifica con las llaves publicas de Microsoft.
async function tokenIdentidad() {
  const pedir = forceRefresh => auth.client.acquireTokenSilent({ scopes: ["User.Read"], account: auth.account, forceRefresh });
  let r = await pedir(false);
  if (!r.idToken || (r.idTokenClaims?.exp || 0) * 1000 - Date.now() < 5 * 60 * 1000) r = await pedir(true);
  return r.idToken;
}

function bloquear(si) {
  estado.enviando = si;
  const b = $("enviar");
  b.disabled = si;
  b.classList.toggle("fac__boton--enviando", si);
  b.textContent = si ? tx("Enviando…", "Sending…") : tx("Enviar factura", "Send invoice");
}

function limpiarForma() {
  CAMPOS.forEach(c => { $(c.id).value = ""; $(c.id).removeAttribute("aria-invalid"); });
  ["xml", "pdf"].forEach(t => { $(ZONAS[t].input).value = ""; $(ZONAS[t].zona)._archivo = null; turno[t]++; estado.revisando[t] = false; });
  Object.assign(estado, { xml: null, pdf: null, errXml: null, errPdf: null, cruce: [] });
  erroresCampos = [];
  repintarZonas();
}

async function enviar(e) {
  e.preventDefault();
  if (estado.enviando) return;
  if (estado.revisando.xml || estado.revisando.pdf) return;
  estado.resultado = null;
  const valores = revisarCampos();
  mostrarMensajes();
  if (erroresCampos.length || estado.errXml || estado.errPdf || estado.cruce.length) {
    $("mensajes").scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

  if (esDemo()) {
    estado.resultado = { tipo: "info", titulo: m("Modo demo: los archivos son válidos y coinciden. En la página publicada la factura se enviaría ahora.", "Demo mode: the files are valid and match. On the published page the invoice would be sent now.") };
    mostrarMensajes();
    return;
  }

  bloquear(true);
  try {
    const cuerpo = {
      ...valores,
      idioma: window.CLARILIUM ? window.CLARILIUM.idioma() : "es",
      xml: { nombre: estado.xml.archivo.name, contenido: aBase64(estado.xml.bytes) },
      pdf: { nombre: estado.pdf.archivo.name, contenido: aBase64(estado.pdf.bytes) }
    };
    let token;
    try { token = await tokenIdentidad(); }
    catch { throw { titulo: m("Tu sesión caducó. Recarga la página para volver a entrar.", "Your session expired. Reload the page to sign in again.") }; }

    let r;
    try {
      r = await fetch(FAC.api, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Clarilium-Token": token },
        body: JSON.stringify(cuerpo)
      });
    } catch { throw { titulo: m("No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.", "The server could not be reached. Check your connection and try again.") }; }

    let datos = {};
    try { datos = await r.json(); } catch { /* respuesta sin cuerpo */ }
    if (r.ok && datos.ok) {
      limpiarForma();
      estado.resultado = { tipo: "ok", titulo: m("¡Listo! Tu factura se envió correctamente.", "Done! Your invoice was sent successfully.") };
      return;
    }
    const lista = Array.isArray(datos.errores) ? datos.errores.filter(x => x && typeof x.es === "string" && typeof x.en === "string") : [];
    if (r.status === 401) throw { titulo: m("Tu sesión no es válida o caducó. Recarga la página para volver a entrar.", "Your session is not valid or expired. Reload the page to sign in again.") };
    if (r.status === 429) throw { titulo: m("Enviaste demasiadas facturas en poco tiempo. Espera unos minutos.", "You sent too many invoices in a short time. Wait a few minutes.") };
    if (lista.length) throw { titulo: m("El servidor rechazó la factura:", "The server rejected the invoice:"), lista };
    throw { titulo: m("No se pudo enviar la factura. Inténtalo más tarde; si persiste, avisa al administrador.", "The invoice could not be sent. Try again later; if it persists, tell the administrator.") };
  } catch (err) {
    estado.resultado = { tipo: "error", titulo: err?.titulo || m("No se pudo enviar la factura.", "The invoice could not be sent."), lista: err?.lista };
  } finally {
    bloquear(false);
    mostrarMensajes();
    $("mensajes").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */
document.addEventListener("DOMContentLoaded", () => {
  $("anio").textContent = String(new Date().getFullYear());
  prepararZona("xml");
  prepararZona("pdf");
  $("forma").addEventListener("submit", enviar);
  CAMPOS.forEach(c => $(c.id).addEventListener("input", () => {
    if ($(c.id).getAttribute("aria-invalid") === "true" && limpiarTexto($(c.id).value, 200)) {
      $(c.id).setAttribute("aria-invalid", "false");
      erroresCampos = erroresCampos.filter(x => !x.es.includes(c.nombre.es));
      mostrarMensajes();
    }
  }));
  // Al cambiar de idioma se vuelven a escribir los mensajes que arma este archivo.
  window.CLARILIUM?.alCambiar(() => { repintarZonas(); mostrarMensajes(); if (!estado.enviando) bloquear(false); });

  iniciarPortal({ alEntrar: () => {}, alDemo: () => {} });
});
