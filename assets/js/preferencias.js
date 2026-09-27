/* ==================================================================== *
 * Preferencias comunes de CLARILIUM: idioma (ES/EN) y tema claro/oscuro.
 *
 * Usa las MISMAS claves que www.clarilium.com (clarilium-idioma y
 * clarilium-tema), asi que la eleccion se respeta en todo el sitio: portada,
 * portal, Timesheet, Estimacion y cualquier pagina que cargue este archivo.
 *
 * Como usarlo en una pagina:
 *   1. <script src=".../preferencias.js"></script> como PRIMERA linea del
 *      <body> (sin defer): aplica idioma y tema antes de pintar, sin parpadeo.
 *   2. Boton de idioma:  cualquier elemento con data-accion="idioma".
 *      Boton de tema:    cualquier elemento con data-accion="tema".
 *   3. Textos fijos del HTML: el texto en espanol va normal y el ingles en
 *      data-en="..." (y data-en-title, data-en-aria-label, data-en-placeholder y
 *      data-en-alt para atributos). Se intercambian solos al cambiar de idioma.
 *   4. Textos que arma el JavaScript: CLARILIUM.t("español", "English").
 *   5. Para repintar al cambiar: CLARILIUM.alCambiar(fn) -> fn({ idioma, tema }).
 * ==================================================================== */
(function () {
  "use strict";

  var CLAVE_IDIOMA = "clarilium-idioma";   // "es" | "en"
  var CLAVE_TEMA = "clarilium-tema";       // "claro" | "oscuro"
  var raiz = document.documentElement;
  var oyentes = [];

  function leer(clave) { try { return localStorage.getItem(clave); } catch (e) { return null; } }
  function guardar(clave, valor) { try { localStorage.setItem(clave, valor); } catch (e) { /* disco o modo privado */ } }

  function idiomaInicial() {
    var param = null;
    try { param = new URLSearchParams(location.search).get("lang"); } catch (e) {}
    if (param === "es" || param === "en") { guardar(CLAVE_IDIOMA, param); return param; }
    var guardado = leer(CLAVE_IDIOMA);
    if (guardado === "es" || guardado === "en") return guardado;
    var idiomas = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < idiomas.length; i++) if (/^es/i.test(idiomas[i])) return "es";
    return idiomas.length && idiomas[0] ? "en" : "es";
  }

  function temaInicial() {
    var guardado = leer(CLAVE_TEMA);
    if (guardado === "claro" || guardado === "oscuro") return guardado;
    // Eleccion previa del Timesheet (antes guardaba el tema por su cuenta).
    try {
      var viejo = JSON.parse(leer("clarilium-timesheet-config-v1") || "{}").theme;
      if (viejo === "dark") return "oscuro";
      if (viejo === "light") return "claro";
    } catch (e) {}
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro";
  }

  var estado = { idioma: idiomaInicial(), tema: temaInicial() };

  function aplicarTema() {
    raiz.setAttribute("data-tema", estado.tema);
    if (document.body) document.body.classList.toggle("dark", estado.tema === "oscuro");
  }

  function aplicarIdioma() {
    raiz.lang = estado.idioma === "en" ? "en" : "es-MX";
  }

  /* ---- Textos fijos del HTML ---- */
  var ATRIBUTOS = ["title", "aria-label", "placeholder", "alt"];

  function traducir(contenedor) {
    var base = contenedor || document;
    var en = estado.idioma === "en";
    var nodos = base.querySelectorAll("[data-en]");
    for (var i = 0; i < nodos.length; i++) {
      var el = nodos[i];
      if (!el.hasAttribute("data-es")) el.setAttribute("data-es", el.textContent);
      el.textContent = en ? el.getAttribute("data-en") : el.getAttribute("data-es");
    }
    ATRIBUTOS.forEach(function (attr) {
      var conAtributo = base.querySelectorAll("[data-en-" + attr + "]");
      for (var j = 0; j < conAtributo.length; j++) {
        var e = conAtributo[j];
        if (!e.hasAttribute("data-es-" + attr)) e.setAttribute("data-es-" + attr, e.getAttribute(attr) || "");
        e.setAttribute(attr, en ? e.getAttribute("data-en-" + attr) : e.getAttribute("data-es-" + attr));
      }
    });
    pintarBotones();
  }

  /* ---- Botones ---- */
  function pintarBotones() {
    var en = estado.idioma === "en";
    var idioma = document.querySelectorAll('[data-accion="idioma"]');
    for (var i = 0; i < idioma.length; i++) {
      var b = idioma[i];
      var etiqueta = b.querySelector("[data-idioma-destino]");
      if (etiqueta) etiqueta.textContent = en ? "ES" : "EN";
      b.setAttribute("lang", en ? "es" : "en");
      b.setAttribute("title", en ? "Cambiar a español" : "Switch to English");
      b.setAttribute("aria-label", en ? "Cambiar a español" : "Cambiar a inglés");
    }
    var tema = document.querySelectorAll('[data-accion="tema"]');
    for (var j = 0; j < tema.length; j++) {
      tema[j].setAttribute("aria-label", en ? "Switch light / dark mode" : "Cambiar entre modo claro y oscuro");
      tema[j].setAttribute("title", en ? "Light / dark mode" : "Modo claro / oscuro");
    }
  }

  function avisar() {
    var copia = { idioma: estado.idioma, tema: estado.tema };
    oyentes.forEach(function (fn) { try { fn(copia); } catch (e) { console.error(e); } });
  }

  function cambiarIdioma(nuevo) {
    nuevo = nuevo === "en" || nuevo === "es" ? nuevo : (estado.idioma === "es" ? "en" : "es");
    if (nuevo === estado.idioma) return;
    estado.idioma = nuevo;
    guardar(CLAVE_IDIOMA, nuevo);
    aplicarIdioma();
    traducir();
    avisar();
  }

  function cambiarTema(nuevo) {
    nuevo = nuevo === "oscuro" || nuevo === "claro" ? nuevo : (estado.tema === "oscuro" ? "claro" : "oscuro");
    if (nuevo === estado.tema) return;
    estado.tema = nuevo;
    guardar(CLAVE_TEMA, nuevo);
    aplicarTema();
    avisar();
  }

  aplicarIdioma();
  aplicarTema();

  document.addEventListener("DOMContentLoaded", function () {
    aplicarTema();
    traducir();
    document.addEventListener("click", function (e) {
      var boton = e.target.closest && e.target.closest("[data-accion]");
      if (!boton) return;
      if (boton.getAttribute("data-accion") === "idioma") { e.preventDefault(); cambiarIdioma(); }
      else if (boton.getAttribute("data-accion") === "tema") { e.preventDefault(); cambiarTema(); }
    });
  });

  // Otra pestana del sitio cambio idioma o tema: esta se pone igual.
  window.addEventListener("storage", function (e) {
    if (e.key === CLAVE_IDIOMA && (e.newValue === "es" || e.newValue === "en") && e.newValue !== estado.idioma) {
      estado.idioma = e.newValue; aplicarIdioma(); traducir(); avisar();
    }
    if (e.key === CLAVE_TEMA && (e.newValue === "claro" || e.newValue === "oscuro") && e.newValue !== estado.tema) {
      estado.tema = e.newValue; aplicarTema(); avisar();
    }
  });

  window.CLARILIUM = {
    idioma: function () { return estado.idioma; },
    tema: function () { return estado.tema; },
    locale: function () { return estado.idioma === "en" ? "en-US" : "es-MX"; },
    t: function (es, en) { return estado.idioma === "en" ? en : es; },
    cambiarIdioma: cambiarIdioma,
    cambiarTema: cambiarTema,
    traducir: traducir,
    alCambiar: function (fn) { if (typeof fn === "function") oyentes.push(fn); }
  };
})();
