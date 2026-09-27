"use strict";

/* Pagina principal del portal · www.clarilium.com/portal
 * Tambien es la direccion de regreso del inicio de sesion de todo el portal:
 * al cargar, portal-auth.js procesa la respuesta de Microsoft y, si el
 * usuario venia de otra pagina del portal, lo devuelve ahi.
 *
 * Contenido: menu con las herramientas (Timesheet, Estimacion y el
 * repositorio de SharePoint), noticias de SAP que entrega /api/noticias y un
 * aviso critico de carga de horas los jueves, viernes y los ultimos 3 dias
 * de cada mes. */

// Grupo de Entra ID "CLARILIUM Reportes - Administradores" (el mismo del TimeSheet).
const GRUPO_ADMIN = "6ee2df68-1c63-4303-b1ee-8367adbf035f";
const CLAVE_TEMA = "clarilium-portal-tema";
const MAX_NOTICIAS = 10;

/* ------------------------------------------------------------------ *
 * Tema claro / oscuro
 * ------------------------------------------------------------------ */
function leerTema() {
  try { return localStorage.getItem(CLAVE_TEMA); } catch { return null; }
}

function guardarTema(tema) {
  try { localStorage.setItem(CLAVE_TEMA, tema); } catch { /* disco o modo privado */ }
}

/* ------------------------------------------------------------------ *
 * Enlaces: publicados apuntan a /timesheet y /estimacion; abiertos desde
 * el disco apuntan a los archivos .html vecinos.
 * ------------------------------------------------------------------ */
function ajustarEnlacesDemo() {
  if (!esDemo()) return;
  document.querySelectorAll("a[data-demo]").forEach(a => { a.href = a.dataset.demo; });
}

/* ------------------------------------------------------------------ *
 * Menu lateral en pantallas angostas
 * ------------------------------------------------------------------ */
function menuAbierto(abrir) {
  const menu = $("sidebar");
  if (abrir) {
    // El menu flotante arranca justo debajo de la barra, aunque arriba haya
    // un aviso (modo demo) o la pagina este desplazada.
    const abajo = Math.max(0, document.querySelector(".topbar").getBoundingClientRect().bottom);
    menu.style.top = `${abajo}px`;
    menu.style.height = `calc(100dvh - ${abajo}px)`;
  }
  menu.classList.toggle("open", abrir);
  $("menuToggle").setAttribute("aria-expanded", String(abrir));
}

/* ------------------------------------------------------------------ *
 * Aviso critico: jueves, viernes y los ultimos 3 dias del mes
 * (fecha local de quien consulta).
 * ------------------------------------------------------------------ */
function tocaAviso(hoy = new Date()) {
  const dia = hoy.getDay();                       // 4 = jueves, 5 = viernes
  if (dia === 4 || dia === 5) return true;
  const ultimo = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).getDate();
  return hoy.getDate() > ultimo - 3;
}

function actualizarAviso() {
  // Solo en modo demo: ?aviso=1 lo fuerza para revisar el diseno cualquier dia.
  const forzado = esDemo() && new URLSearchParams(window.location.search).get("aviso") === "1";
  $("aviso").hidden = !(forzado || tocaAviso());
}

/* ------------------------------------------------------------------ *
 * Noticias
 * ------------------------------------------------------------------ */
const FUENTES = ["sapnews", "community"];

const formatoFecha = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" });
const formatoHora = new Intl.DateTimeFormat("es-MX", { hour: "numeric", minute: "2-digit" });

function crear(etiqueta, clase, texto) {
  const el = document.createElement(etiqueta);
  if (clase) el.className = clase;
  if (texto != null) el.textContent = texto;
  return el;
}

function enlaceSeguro(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "https:" || u.protocol === "http:") ? u.href : null;
  } catch { return null; }
}

function pintarCargando(lista) {
  lista.setAttribute("aria-busy", "true");
  lista.replaceChildren(...[0, 1, 2].map(() => {
    const li = crear("li", "news-item");
    li.append(crear("span", "skeleton"), crear("span", "skeleton skeleton--corta"));
    return li;
  }));
}

function pintarFuente(id, fuente) {
  const lista = $(`noticias-${id}`);
  lista.setAttribute("aria-busy", "false");
  const items = (fuente?.items || []).slice(0, MAX_NOTICIAS);

  if (!items.length) {
    const li = crear("li", "news-item");
    li.append(crear("p", fuente?.ok === false ? "news-empty news-empty--error" : "news-empty",
      fuente?.ok === false
        ? "No se pudieron cargar las noticias de esta fuente en este momento. Usa «Ver sitio» o vuelve a intentar más tarde."
        : "Sin publicaciones recientes."));
    lista.replaceChildren(li);
    return;
  }

  lista.replaceChildren(...items.map(n => {
    const li = crear("li", "news-item");
    const url = enlaceSeguro(n.enlace);
    const titulo = crear(url ? "a" : "span", "news-item__title", n.titulo || "(sin título)");
    if (url) { titulo.href = url; titulo.target = "_blank"; titulo.rel = "noopener noreferrer"; }
    li.append(titulo);

    const fecha = n.fecha ? new Date(n.fecha) : null;
    const meta = [fecha && !isNaN(fecha) ? formatoFecha.format(fecha) : "", n.autor || ""].filter(Boolean).join(" · ");
    if (meta) li.append(crear("span", "news-item__meta", meta));
    if (n.resumen) li.append(crear("p", "news-item__summary", n.resumen));
    return li;
  }));
}

function noticiasDemo() {
  const hoy = Date.now(), dia = 86400000;
  const ej = (titulo, autor, dias, resumen) => ({ titulo, enlace: "https://news.sap.com/", autor, fecha: new Date(hoy - dias * dia).toISOString(), resumen });
  return {
    generado: new Date().toISOString(),
    fuentes: [
      { id: "sapnews", ok: true, items: [
        ej("Noticia de ejemplo: SAP presenta nuevas capacidades de IA", "SAP News", 0, "Texto de ejemplo. Publicada, esta sección muestra las noticias reales de news.sap.com."),
        ej("Noticia de ejemplo: actualización de SAP Business Technology Platform", "SAP News", 1, "Texto de ejemplo con el resumen de la publicación."),
        ej("Noticia de ejemplo: resultados trimestrales", "SAP News", 3, "Texto de ejemplo con el resumen de la publicación.")
      ] },
      { id: "community", ok: true, items: [
        ej("Blog de ejemplo: buenas prácticas de ABAP Cloud", "Autor de ejemplo", 0, "Texto de ejemplo. Publicada, esta sección muestra los blogs reales de SAP Community."),
        ej("Blog de ejemplo: extensiones Fiori con SAPUI5", "Autor de ejemplo", 2, "Texto de ejemplo con el resumen del blog."),
        ej("Blog de ejemplo: integración con SAP Integration Suite", "Autor de ejemplo", 4, "Texto de ejemplo con el resumen del blog.")
      ] }
    ]
  };
}

let cargandoNoticias = false;

async function cargarNoticias() {
  if (cargandoNoticias) return;
  cargandoNoticias = true;
  const estado = $("noticiasEstado");
  const boton = $("refreshNow");
  estado.classList.remove("section-context--error");
  estado.textContent = "Cargando noticias…";
  boton.disabled = true;
  FUENTES.forEach(id => pintarCargando($(`noticias-${id}`)));

  try {
    let datos;
    if (esDemo()) {
      datos = noticiasDemo();
    } else {
      let r;
      try { r = await fetch("/api/noticias", { headers: { Accept: "application/json" }, cache: "no-cache" }); }
      catch { throw new Error("No se pudo contactar al servidor. Revisa tu conexión a internet."); }
      if (!r.ok) throw new Error(`El servidor de noticias respondió HTTP ${r.status}.`);
      datos = await r.json();
    }
    FUENTES.forEach(id => pintarFuente(id, (datos.fuentes || []).find(f => f.id === id)));
    const generado = datos.generado ? new Date(datos.generado) : new Date();
    const hora = formatoHora.format(generado);
    estado.textContent = `Lo más reciente de SAP News Center y SAP Community. Actualizado a las ${hora}${hora.endsWith(".") ? "" : "."}`;
  } catch (error) {
    FUENTES.forEach(id => pintarFuente(id, { ok: false, items: [] }));
    estado.textContent = error.message || "No se pudieron cargar las noticias.";
    estado.classList.add("section-context--error");
  } finally {
    boton.disabled = false;
    cargandoNoticias = false;
  }
}

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */
function rolDeCuenta() {
  if (esDemo()) return "Administrador";
  const grupos = auth.account?.idTokenClaims?.groups;
  return Array.isArray(grupos) && grupos.includes(GRUPO_ADMIN) ? "Administrador" : "Consultor";
}

function alEntrar() {
  const rol = rolDeCuenta();
  $("cuentaRol").textContent = rol;
  $("cuenta").title = `${$("cuentaNombre").textContent} · ${rol}`;
  actualizarAviso();
  // Revisa cada 10 minutos: si la pagina queda abierta al cambiar el dia,
  // el aviso aparece o se retira solo.
  setInterval(actualizarAviso, 10 * 60 * 1000);
  return cargarNoticias();
}

document.addEventListener("DOMContentLoaded", () => {
  // Dentro del marco oculto de la verificacion silenciosa no se hace nada.
  if (window.self !== window.top) return;

  document.body.classList.toggle("dark", leerTema() === "dark");
  ajustarEnlacesDemo();

  $("themeToggle").addEventListener("click", () => {
    const oscuro = document.body.classList.toggle("dark");
    guardarTema(oscuro ? "dark" : "light");
  });
  $("refreshNow").addEventListener("click", () => { actualizarAviso(); cargarNoticias(); });
  $("menuToggle").addEventListener("click", () => menuAbierto(!$("sidebar").classList.contains("open")));
  $("main").addEventListener("click", () => menuAbierto(false));
  document.addEventListener("keydown", e => { if (e.key === "Escape") menuAbierto(false); });
  $("sidebar").addEventListener("click", e => { if (e.target.closest("a")) menuAbierto(false); });
  // Al volver a pantalla ancha, el menu recupera su posicion normal.
  window.matchMedia("(min-width: 1025px)").addEventListener("change", e => {
    if (!e.matches) return;
    menuAbierto(false);
    $("sidebar").style.removeProperty("top");
    $("sidebar").style.removeProperty("height");
  });

  iniciarPortal({ alEntrar, alDemo: alEntrar, nombreDemo: "Usuario Demo" }).catch(error => {
    console.error("Portal: fallo al iniciar", error);
    porton({ error: error.message || "Ocurrió un error inesperado.", reintentar: true });
  });
});
