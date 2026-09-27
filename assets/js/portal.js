"use strict";

/* Pagina principal del portal · www.clarilium.com/portal
 * Tambien es la direccion de regreso del inicio de sesion de todo el portal:
 * al cargar, portal-auth.js procesa la respuesta de Microsoft y, si el
 * usuario venia de otra pagina del portal, lo devuelve ahi.
 *
 * Contenido: menu con las herramientas (Timesheet, Estimacion y el
 * repositorio de SharePoint), noticias de SAP que entrega /api/noticias y un
 * aviso critico de carga de horas los jueves, viernes y los ultimos 3 dias
 * de cada mes.
 *
 * Idioma y tema: los maneja preferencias.js (mismas claves que todo el sitio).
 * Los textos fijos del HTML llevan su version en ingles en data-en; los que
 * se arman aqui usan t("español", "English"). */

// Grupo de Entra ID "CLARILIUM Reportes - Administradores" (el mismo del TimeSheet).
const GRUPO_ADMIN = "6ee2df68-1c63-4303-b1ee-8367adbf035f";
const MAX_NOTICIAS = 10;
const t = (es, en) => CLARILIUM.t(es, en);

/* ------------------------------------------------------------------ *
 * Enlaces: publicados apuntan a /portal/timesheet, /estimacion y
 * /portal/facturacion; abiertos desde
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
 * Aviso critico (fecha local de quien consulta):
 *   - Ultimos 3 dias habiles del mes (lunes a viernes): en rojo.
 *   - Jueves y viernes: en amarillo.
 * Si un jueves o viernes cae en los ultimos 3 dias habiles, gana el rojo.
 * No considera dias festivos.
 * ------------------------------------------------------------------ */
function esHabil(fecha) { const d = fecha.getDay(); return d !== 0 && d !== 6; }

function esCierreDeMes(hoy) {
  if (!esHabil(hoy)) return false;
  let habiles = 0;
  const dia = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);   // ultimo dia del mes
  while (habiles < 3) {
    if (esHabil(dia)) {
      habiles += 1;
      if (dia.getDate() === hoy.getDate()) return true;
    }
    dia.setDate(dia.getDate() - 1);
  }
  return false;
}

function tipoAviso(hoy = new Date()) {
  if (esCierreDeMes(hoy)) return "cierre";
  const d = hoy.getDay();                          // 4 = jueves, 5 = viernes
  return d === 4 || d === 5 ? "semanal" : null;
}

function actualizarAviso() {
  // Solo en modo demo, para revisar el diseno cualquier dia:
  // ?aviso=1 (amarillo) o ?aviso=cierre (rojo).
  const forzado = esDemo() ? new URLSearchParams(window.location.search).get("aviso") : null;
  const tipo = forzado === "cierre" ? "cierre" : forzado === "1" ? "semanal" : tipoAviso();
  const aviso = $("aviso");
  aviso.hidden = !tipo;
  aviso.classList.toggle("aviso--semanal", tipo === "semanal");
  aviso.classList.toggle("aviso--cierre", tipo === "cierre");
}

/* ------------------------------------------------------------------ *
 * Noticias
 * ------------------------------------------------------------------ */
const FUENTES = ["sapnews", "community"];
const noticiasPorIdioma = {};     // idioma -> ultima respuesta buena
let ultimaCarga = null;           // { idioma, datos } o { idioma, error }

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
  const formatoFecha = new Intl.DateTimeFormat(CLARILIUM.locale(), { day: "numeric", month: "short", year: "numeric" });

  if (!items.length) {
    const li = crear("li", "news-item");
    li.append(crear("p", fuente?.ok === false ? "news-empty news-empty--error" : "news-empty",
      fuente?.ok === false
        ? t("No se pudieron cargar las noticias de esta fuente en este momento. Usa «Ver sitio» o vuelve a intentar más tarde.",
            "News from this source could not be loaded right now. Use “Visit site” or try again later.")
        : t("Sin publicaciones recientes.", "No recent posts.")));
    lista.replaceChildren(li);
    return;
  }

  lista.replaceChildren(...items.map(n => {
    const li = crear("li", "news-item");
    const url = enlaceSeguro(n.enlace);
    const titulo = crear(url ? "a" : "span", "news-item__title", n.titulo || t("(sin título)", "(untitled)"));
    if (url) { titulo.href = url; titulo.target = "_blank"; titulo.rel = "noopener noreferrer"; }
    li.append(titulo);

    const fecha = n.fecha ? new Date(n.fecha) : null;
    const meta = [fecha && !isNaN(fecha) ? formatoFecha.format(fecha) : "", n.autor || ""].filter(Boolean).join(" · ");
    if (meta) li.append(crear("span", "news-item__meta", meta));
    if (n.resumen) li.append(crear("p", "news-item__summary", n.resumen));
    return li;
  }));
}

function pintarEstado() {
  const estado = $("noticiasEstado");
  estado.classList.remove("section-context--error");
  if (!ultimaCarga) { estado.textContent = t("Cargando noticias…", "Loading news…"); return; }
  if (ultimaCarga.error) {
    estado.textContent = t("No se pudieron cargar las noticias. Revisa tu conexión y vuelve a intentar.",
                           "News could not be loaded. Check your connection and try again.");
    estado.classList.add("section-context--error");
    return;
  }
  const datos = ultimaCarga.datos;
  const hora = new Intl.DateTimeFormat(CLARILIUM.locale(), { hour: "numeric", minute: "2-digit" })
    .format(datos.generado ? new Date(datos.generado) : new Date());
  let texto = t(`Lo más reciente de SAP News Center y SAP Community. Actualizado a las ${hora}`,
                `The latest from SAP News Center and SAP Community. Updated at ${hora}`);
  if (!/\.$/.test(texto)) texto += ".";
  if (ultimaCarga.idioma === "es") {
    texto += datos.traduccion === "ok"
      ? " Traducción automática al español."
      : " La traducción automática no está disponible por ahora; las noticias se muestran en inglés.";
  }
  estado.textContent = texto;
}

function noticiasDemo(idioma) {
  const hoy = Date.now(), dia = 86400000;
  const es = idioma === "es";
  const ej = (tituloEs, tituloEn, autor, dias, resumenEs, resumenEn) => ({
    titulo: es ? tituloEs : tituloEn, enlace: "https://news.sap.com/",
    autor: autor === "Autor de ejemplo" && !es ? "Sample author" : autor,
    fecha: new Date(hoy - dias * dia).toISOString(), resumen: es ? resumenEs : resumenEn
  });
  return {
    generado: new Date().toISOString(),
    traduccion: es ? "ok" : undefined,
    fuentes: [
      { id: "sapnews", ok: true, items: [
        ej("Noticia de ejemplo: SAP presenta nuevas capacidades de IA", "Sample news: SAP introduces new AI capabilities", "SAP News", 0,
           "Texto de ejemplo. Publicada, esta sección muestra las noticias reales de news.sap.com.", "Sample text. Once published, this section shows the real news from news.sap.com."),
        ej("Noticia de ejemplo: actualización de SAP Business Technology Platform", "Sample news: SAP Business Technology Platform update", "SAP News", 1,
           "Texto de ejemplo con el resumen de la publicación.", "Sample text with the post summary."),
        ej("Noticia de ejemplo: resultados trimestrales", "Sample news: quarterly results", "SAP News", 3,
           "Texto de ejemplo con el resumen de la publicación.", "Sample text with the post summary.")
      ] },
      { id: "community", ok: true, items: [
        ej("Blog de ejemplo: buenas prácticas de ABAP Cloud", "Sample blog: ABAP Cloud best practices", "Autor de ejemplo", 0,
           "Texto de ejemplo. Publicada, esta sección muestra los blogs reales de SAP Community.", "Sample text. Once published, this section shows the real SAP Community blogs."),
        ej("Blog de ejemplo: extensiones Fiori con SAPUI5", "Sample blog: Fiori extensions with SAPUI5", "Autor de ejemplo", 2,
           "Texto de ejemplo con el resumen del blog.", "Sample text with the blog summary."),
        ej("Blog de ejemplo: integración con SAP Integration Suite", "Sample blog: integration with SAP Integration Suite", "Autor de ejemplo", 4,
           "Texto de ejemplo con el resumen del blog.", "Sample text with the blog summary.")
      ] }
    ]
  };
}

let cargaEnCurso = 0;

async function cargarNoticias({ forzar = false } = {}) {
  const idioma = CLARILIUM.idioma();
  const turno = ++cargaEnCurso;   // si cambian de idioma a medio camino, gana la ultima

  if (!forzar && noticiasPorIdioma[idioma]) {
    ultimaCarga = { idioma, datos: noticiasPorIdioma[idioma] };
    FUENTES.forEach(id => pintarFuente(id, (ultimaCarga.datos.fuentes || []).find(f => f.id === id)));
    pintarEstado();
    return;
  }

  ultimaCarga = null;
  pintarEstado();
  $("refreshNow").disabled = true;
  FUENTES.forEach(id => pintarCargando($(`noticias-${id}`)));

  let resultado;
  try {
    let datos;
    if (esDemo()) {
      datos = noticiasDemo(idioma);
    } else {
      const r = await fetch(`/api/noticias?idioma=${idioma}`, { headers: { Accept: "application/json" }, cache: "no-cache" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      datos = await r.json();
    }
    noticiasPorIdioma[idioma] = datos;
    resultado = { idioma, datos };
  } catch (error) {
    console.error("Portal: noticias", error);
    resultado = { idioma, error: true };
  }

  if (turno !== cargaEnCurso) return;
  ultimaCarga = resultado;
  FUENTES.forEach(id => pintarFuente(id, resultado.error ? { ok: false, items: [] } : (resultado.datos.fuentes || []).find(f => f.id === id)));
  pintarEstado();
  $("refreshNow").disabled = false;
}

/* ------------------------------------------------------------------ *
 * Arranque
 * ------------------------------------------------------------------ */
function esAdmin() {
  if (esDemo()) return true;
  const grupos = auth.account?.idTokenClaims?.groups;
  return Array.isArray(grupos) && grupos.includes(GRUPO_ADMIN);
}

function pintarCuenta() {
  const rol = esAdmin() ? t("Administrador", "Administrator") : t("Consultor", "Consultant");
  if (esDemo()) $("cuentaNombre").textContent = t("Usuario Demo", "Demo User");
  $("cuentaRol").textContent = rol;
  $("cuenta").title = `${$("cuentaNombre").textContent} · ${rol}`;
}

let dentro = false;

function alEntrar() {
  dentro = true;
  pintarCuenta();
  actualizarAviso();
  // Revisa cada 10 minutos: si la pagina queda abierta al cambiar el dia,
  // el aviso aparece o se retira solo.
  setInterval(actualizarAviso, 10 * 60 * 1000);
  return cargarNoticias();
}

document.addEventListener("DOMContentLoaded", () => {
  // Dentro del marco oculto de la verificacion silenciosa no se hace nada.
  if (window.self !== window.top) return;

  ajustarEnlacesDemo();

  $("refreshNow").addEventListener("click", () => { actualizarAviso(); cargarNoticias({ forzar: true }); });
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

  // Cambio de idioma: textos armados aqui y noticias en el idioma nuevo.
  CLARILIUM.alCambiar(({ idioma }) => {
    if (!dentro) return;
    pintarCuenta();
    if (ultimaCarga?.idioma !== idioma) cargarNoticias();
    else pintarEstado();
  });

  pintarEstado();
  iniciarPortal({ alEntrar, alDemo: alEntrar }).catch(error => {
    console.error("Portal: fallo al iniciar", error);
    porton({ error: error.message || t("Ocurrió un error inesperado.", "An unexpected error occurred."), reintentar: true });
  });
});
