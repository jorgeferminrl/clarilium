/* CLARILIUM — comportamiento del sitio
   Año del pie
   0. Años de experiencia (calculados desde octubre de 2007)
   1. Tema claro / oscuro (recuerda la elección)
   2. Idioma (recuerda la elección; la detección automática va en el <head>)
   3. Menú móvil y submenú de Servicios
   3b. Altura real de la barra fija, para que los saltos a sección no queden tapados
   4. Sección activa en la navegación
   5. Envío del formulario de contacto a /api/contacto
*/
(function () {
  'use strict';

  var raiz = document.documentElement;

  /* ---- Año del pie ----
     Antes era un script en línea; vive aquí para que la CSP no necesite
     autorizar más bloques incrustados. El HTML ya trae el año de respaldo. */
  (function anioDelPie() {
    var nodo = document.getElementById('anio');
    if (nodo) nodo.textContent = String(new Date().getFullYear());
  })();

  /* ---- 0. Años de experiencia, calculados desde el 1 de octubre de 2007 ---- */
  var INICIO = new Date(2007, 9, 1); // mes 9 = octubre
  (function aniosDeExperiencia() {
    var hoy = new Date();
    var anios = hoy.getFullYear() - INICIO.getFullYear();
    var mes = hoy.getMonth() - INICIO.getMonth();
    if (mes < 0 || (mes === 0 && hoy.getDate() < INICIO.getDate())) anios--;
    var nodos = document.querySelectorAll('[data-anios]');
    for (var i = 0; i < nodos.length; i++) nodos[i].textContent = String(anios);
  })();

  /* ---- 1. Tema ---- */
  var btnTema = document.getElementById('btn-tema');
  if (btnTema) {
    btnTema.addEventListener('click', function () {
      var actual = raiz.getAttribute('data-tema');
      if (!actual) {
        var prefiereOscuro = window.matchMedia('(prefers-color-scheme: dark)').matches;
        actual = prefiereOscuro ? 'oscuro' : 'claro';
      }
      var nuevo = actual === 'oscuro' ? 'claro' : 'oscuro';
      raiz.setAttribute('data-tema', nuevo);
      try { localStorage.setItem('clarilium-tema', nuevo); } catch (e) {}
    });
  }

  /* ---- 2. Idioma: al pulsar el botón, recordamos la elección ---- */
  var btnIdioma = document.getElementById('btn-idioma');
  if (btnIdioma) {
    btnIdioma.addEventListener('click', function () {
      try { localStorage.setItem('clarilium-idioma', raiz.lang.indexOf('es') === 0 ? 'en' : 'es'); } catch (e) {}
    });
  }

  /* ---- 3. Menú móvil y submenú ---- */
  var toggle = document.querySelector('.nav-toggle');
  var cerrar = document.querySelector('.nav-cerrar');
  var nav = document.getElementById('nav-principal');
  var velo = document.getElementById('velo');
  var flecha = document.querySelector('.submenu__flecha');

  function abrirMenu(abrir) {
    if (!toggle || !nav) return;
    toggle.setAttribute('aria-expanded', String(abrir));
    nav.setAttribute('data-abierto', String(abrir));
    if (velo) { velo.hidden = !abrir; velo.setAttribute('data-visible', String(abrir)); }
    document.body.style.overflow = abrir && window.matchMedia('(max-width: 880px)').matches ? 'hidden' : '';
  }

  if (toggle) toggle.addEventListener('click', function () {
    abrirMenu(toggle.getAttribute('aria-expanded') !== 'true');
  });
  if (cerrar) cerrar.addEventListener('click', function () { abrirMenu(false); });
  if (velo) velo.addEventListener('click', function () { abrirMenu(false); });

  if (flecha) {
    flecha.addEventListener('click', function () {
      flecha.setAttribute('aria-expanded', String(flecha.getAttribute('aria-expanded') !== 'true'));
    });
  }

  if (nav) {
    // Al elegir un destino, cerramos el panel móvil y el submenú
    nav.addEventListener('click', function (e) {
      if (e.target.tagName !== 'A') return;
      abrirMenu(false);
      if (flecha) flecha.setAttribute('aria-expanded', 'false');
    });
  }

  // Escape cierra lo que esté abierto
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    abrirMenu(false);
    if (flecha) flecha.setAttribute('aria-expanded', 'false');
  });

  // Al volver a escritorio, se limpia el estado del panel móvil
  window.addEventListener('resize', function () {
    if (!window.matchMedia('(max-width: 880px)').matches) abrirMenu(false);
  });

  /* ---- 3b. Altura real de la barra fija ----
     El cintillo se parte en dos líneas en pantallas angostas, así que la barra
     mide ~113px en escritorio y ~168px en móvil. Publicamos la altura medida en
     --alto-barra y el CSS la usa como scroll-padding-top. */
  var barraFija = document.querySelector('.barra-superior');
  function medirBarra() {
    if (!barraFija) return;
    var alto = Math.round(barraFija.getBoundingClientRect().height);
    if (alto > 0) raiz.style.setProperty('--alto-barra', alto + 'px');
  }
  medirBarra();
  window.addEventListener('resize', medirBarra);
  window.addEventListener('orientationchange', medirBarra);
  if (barraFija && 'ResizeObserver' in window) new ResizeObserver(medirBarra).observe(barraFija);
  // Las tipografías web cambian el alto del cintillo al terminar de cargar.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(medirBarra);

  /* ---- 4. Sección activa ---- */
  var enlaces = Array.prototype.slice.call(document.querySelectorAll('.nav a[href^="#"]'));
  var secciones = enlaces
    .map(function (a) { return document.querySelector(a.getAttribute('href')); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && secciones.length) {
    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (!entrada.isIntersecting) return;
        enlaces.forEach(function (a) {
          a.setAttribute('aria-current', String(a.getAttribute('href') === '#' + entrada.target.id));
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    secciones.forEach(function (s) { obs.observe(s); });
  }

  /* ---- 5. Formulario de contacto ---- */
  var form = document.getElementById('form-contacto');
  if (!form) return;

  var aviso = document.getElementById('form-aviso');
  var boton = form.querySelector('button[type="submit"]');
  var t = {
    enviando: form.dataset.textoEnviando,
    enviar: boton ? boton.textContent.trim() : '',
    ok: form.dataset.textoOk,
    error: form.dataset.textoError,
    limite: form.dataset.textoLimite || form.dataset.textoError
  };

  function mostrar(tipo, mensaje) {
    if (!aviso) return;
    aviso.className = 'aviso aviso--' + tipo;
    aviso.textContent = mensaje;
    aviso.hidden = false;
    aviso.setAttribute('role', 'status');
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (aviso) aviso.hidden = true;

    var datos = {};
    new FormData(form).forEach(function (v, k) { datos[k] = v; });

    if (!form.checkValidity()) { form.reportValidity(); return; }

    if (boton) { boton.disabled = true; boton.textContent = t.enviando; }

    fetch('/api/contacto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: datos.nombre,
        empresa: datos.empresa,
        correo: datos.correo,
        telefono: datos.telefono,
        mensaje: datos.mensaje,
        idioma: raiz.lang,
        // Campo trampa antispam: va siempre, y es el servidor quien decide.
        sitioWeb: datos.sitioWeb || ''
      })
    })
      .then(function (r) {
        if (!r.ok) { var e = new Error('HTTP ' + r.status); e.estado = r.status; throw e; }
        return r.json();
      })
      .then(function () { mostrar('ok', t.ok); form.reset(); })
      .catch(function (e) { mostrar('error', e && e.estado === 429 ? t.limite : t.error); })
      .finally(function () {
        if (boton) { boton.disabled = false; boton.textContent = t.enviar; }
      });
  });
})();
