# -*- coding: utf-8 -*-
"""Genera las cuatro páginas de servicio en los dos idiomas.

Las URLs son las mismas que tenía el sitio de Google Sites, para no perder los
enlaces existentes ni el posicionamiento:

    /servicios/abap  /servicios/fiori  /servicios/sapui5  /servicios/cloud
    /en/services/abap  …

En disco cada página es un archivo suelto —`servicios/abap.html`— y las URLs
limpias se mantienen con los `rewrite` de `staticwebapp.config.json`.

Todas las rutas son relativas, así que las páginas también se pueden revisar
con doble clic desde el disco.
"""
import pathlib

RAIZ = pathlib.Path(__file__).resolve().parent.parent

# ---------------------------------------------------------------- contenido --

SERVICIOS = ['abap', 'fiori', 'sapui5', 'cloud']

ICONO = {
    'abap':   ('tec-abap.webp',  'SAP ABAP'),
    'fiori':  ('tec-fiori.webp', 'SAP Fiori'),
    'sapui5': ('tec-ui5.webp',   'SAPUI5'),
    'cloud':  ('tec-cap.webp',   'SAP Cloud Application Programming'),
}

CONTENIDO = {
    'es': {
        'abap': {
            'nombre': 'ABAP',
            'titulo': 'Servicios de Fábrica de Software ABAP',
            'meta': 'Fábrica de software ABAP: soporte 24/7, S/4HANA y ECC, RAP, CAP, ABAP HCM y Web Dynpro.',
            'lista': ['Fábrica de software ABAP',
                      'Soporte ABAP 24/7',
                      'Sistemas S/4HANA, ECC para servidores',
                      'On-Premise (Restful Application Programming)',
                      'Cloud (Cloud Application Programming)',
                      'ABAP HCM',
                      'Web Dynpro'],
        },
        'fiori': {
            'nombre': 'Fiori',
            'titulo': 'Servicios de Fábrica de Software Fiori',
            'meta': 'Fábrica de software Fiori: activación, configuración, roles, Launchpad, adaptación y creación de aplicaciones.',
            'lista': ['Activación',
                      'Configuración',
                      'Roles',
                      'Administración de contenido Fiori Launchpad',
                      'Adaptación de aplicaciones',
                      'Creación de aplicaciones',
                      'Resolución de problemas',
                      'Capacitaciones'],
        },
        'sapui5': {
            'nombre': 'SAPUI5',
            'titulo': 'Servicios de Fábrica de Software SAPUI5',
            'meta': 'Fábrica de software SAPUI5: desarrollo y extensión de aplicaciones, Fiori elements, controles y capacitaciones.',
            'lista': ['Desarrollo de aplicaciones',
                      'Extensión de aplicaciones',
                      'Fiori elements',
                      'Controles',
                      'Capacitaciones'],
        },
        'cloud': {
            'nombre': 'Cloud',
            'titulo': 'Servicios de Fábrica de Software Cloud',
            'meta': 'Fábrica de software Cloud: proyectos full-stack y back-end, modelado y exposición de servicios sobre SAP BTP y CAP.',
            'lista': ['Proyectos Full-Stack',
                      'Proyectos Back-End',
                      'Modelado de servicios',
                      'Exposición de servicios'],
        },
    },
    'en': {
        'abap': {
            'nombre': 'ABAP',
            'titulo': 'ABAP Software Factory Services',
            'meta': 'ABAP software factory: 24/7 support, S/4HANA and ECC, RAP, CAP, ABAP HCM and Web Dynpro.',
            'lista': ['ABAP software factory',
                      '24/7 ABAP support',
                      'S/4HANA and ECC systems for servers',
                      'On-premise (RESTful Application Programming)',
                      'Cloud (Cloud Application Programming)',
                      'ABAP HCM',
                      'Web Dynpro'],
        },
        'fiori': {
            'nombre': 'Fiori',
            'titulo': 'Fiori Software Factory Services',
            'meta': 'Fiori software factory: activation, configuration, roles, Launchpad, app adaptation and development.',
            'lista': ['Activation',
                      'Configuration',
                      'Roles',
                      'Fiori Launchpad content management',
                      'App adaptation',
                      'App development',
                      'Troubleshooting',
                      'Training'],
        },
        'sapui5': {
            'nombre': 'SAPUI5',
            'titulo': 'SAPUI5 Software Factory Services',
            'meta': 'SAPUI5 software factory: application development and extension, Fiori elements, controls and training.',
            'lista': ['Application development',
                      'Application extension',
                      'Fiori elements',
                      'Controls',
                      'Training'],
        },
        'cloud': {
            'nombre': 'Cloud',
            'titulo': 'Cloud Software Factory Services',
            'meta': 'Cloud software factory: full-stack and back-end projects, service modelling and service exposure on SAP BTP and CAP.',
            'lista': ['Full-stack projects',
                      'Back-end projects',
                      'Service modelling',
                      'Service exposure'],
        },
    },
}

TEXTOS = {
    'es': {
        'htmlLang': 'es-MX', 'ogLocale': 'es_MX',
        'saltar': 'Saltar al contenido principal',
        'cintillo': '¡Tenemos las mejores tarifas y servicio del mercado!',
        'cintilloBoton': 'Más información',
        'abrirMenu': 'Abrir menú', 'cerrarMenu': 'Cerrar menú',
        'navAria': 'Navegación principal', 'marcaAria': 'CLARILIUM — inicio',
        'inicio': 'Inicio', 'servicios': 'Servicios', 'nosotros': 'Nosotros', 'contacto': 'Contacto',
        'idiomaBoton': 'EN', 'idiomaTitulo': 'Switch to English', 'idiomaAria': 'Cambiar a inglés',
        'temaAria': 'Cambiar entre modo claro y oscuro', 'temaTitulo': 'Modo claro / oscuro',
        'franja': 'Fábrica de Software ABAP, Fiori y SAP Cloud',
        'logoAlt': 'CLARILIUM — Ideas claras, soluciones claras',
        'aliado': 'Estamos aquí para ser su mejor aliado',
        'aliadoAlt': 'Consultores de CLARILIUM',
        'cta': 'Para mayor información, haga clic en el botón de Contacto',
        'volver': 'Volver al inicio',
        'direccion': 'Avenida de las Torres Coto 16, Real del Valle,<br>Mazatlán, Sinaloa, México, CP 82124',
        'marcas': 'SAP, ABAP, Fiori, SAPUI5 y SAP BTP son marcas registradas de SAP SE',
        'migaInicio': 'Inicio',
    },
    'en': {
        'htmlLang': 'en', 'ogLocale': 'en_US',
        'saltar': 'Skip to main content',
        'cintillo': 'We have the best rates and service on the market!',
        'cintilloBoton': 'More information',
        'abrirMenu': 'Open menu', 'cerrarMenu': 'Close menu',
        'navAria': 'Main navigation', 'marcaAria': 'CLARILIUM — home',
        'inicio': 'Home', 'servicios': 'Services', 'nosotros': 'About', 'contacto': 'Contact',
        'idiomaBoton': 'ES', 'idiomaTitulo': 'Cambiar a español', 'idiomaAria': 'Switch to Spanish',
        'temaAria': 'Switch between light and dark mode', 'temaTitulo': 'Light / dark mode',
        'franja': 'ABAP, Fiori and SAP Cloud Software Factory',
        'logoAlt': 'CLARILIUM — Clear ideas, clear solutions',
        'aliado': 'We are here to be your best ally',
        'aliadoAlt': 'CLARILIUM consultants',
        'cta': 'For more information, click the Contact button',
        'volver': 'Back to the home page',
        'direccion': 'Avenida de las Torres Coto 16, Real del Valle,<br>Mazatlán, Sinaloa, Mexico, postal code 82124',
        'marcas': 'SAP, ABAP, Fiori, SAPUI5 and SAP BTP are registered trademarks of SAP SE',
        'migaInicio': 'Home',
    },
}

# En disco: servicios/<slug>.html  y  en/services/<slug>.html
CARPETA = {'es': 'servicios', 'en': 'en/services'}
RAIZ_REL = {'es': '../', 'en': '../../'}
CASA = {'es': '../index.html', 'en': '../index.html'}
ANCLA = {'es': {'inicio': 'inicio', 'nosotros': 'nosotros', 'contacto': 'contacto'},
         'en': {'inicio': 'home',   'nosotros': 'about',    'contacto': 'contact'}}
URL = {'es': 'https://clarilium.com/servicios/{}',
       'en': 'https://clarilium.com/en/services/{}'}


def pagina(idioma, slug):
    t = TEXTOS[idioma]
    c = CONTENIDO[idioma][slug]
    p = RAIZ_REL[idioma]           # a la raíz del sitio
    casa = CASA[idioma]            # al inicio en este idioma
    a = ANCLA[idioma]
    icono, iconoAlt = ICONO[slug]
    logo = 'logo-hero.png' if idioma == 'es' else 'logo-hero-en.png'
    og = 'og-es.png' if idioma == 'es' else 'og-en.png'

    # hermano en el otro idioma
    if idioma == 'es':
        otro, otroLang, otroParam = f'../en/services/{slug}.html', 'en', 'en'
    else:
        otro, otroLang, otroParam = f'../../servicios/{slug}.html', 'es-mx', 'es'

    base = 'servicios' if idioma == 'es' else 'en/services'
    filas = []
    for s in SERVICIOS:
        actual = ' aria-current="page"' if s == slug else ''
        nombre = CONTENIDO[idioma][s]['nombre']
        filas.append(f'            <li><a href="{p}{base}/{s}.html"{actual}>{nombre}</a></li>')
    submenu = '\n'.join(filas)

    lista = '\n'.join(f'          <li>{x}</li>' for x in c['lista'])

    # redirección automática de idioma, igual que en la portada pero al hermano
    if idioma == 'es':
        deteccion = (f"      if (!hablaEspanol) location.replace('{otro}');\n"
                     f"    }} else if (elegido === 'en') {{\n"
                     f"      location.replace('{otro}');")
    else:
        deteccion = (f"      if (hablaEspanol) location.replace('{otro}');\n"
                     f"    }} else if (elegido === 'es') {{\n"
                     f"      location.replace('{otro}');")

    return f'''<!DOCTYPE html>
<html lang="{t['htmlLang']}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{c['titulo']} — CLARILIUM</title>
<meta name="description" content="{c['meta']}">
<link rel="canonical" href="{URL[idioma].format(slug)}">
<link rel="alternate" hreflang="es-mx" href="{URL['es'].format(slug)}">
<link rel="alternate" hreflang="en" href="{URL['en'].format(slug)}">
<link rel="alternate" hreflang="x-default" href="{URL['es'].format(slug)}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="CLARILIUM">
<meta property="og:title" content="{c['titulo']} — CLARILIUM">
<meta property="og:description" content="{c['meta']}">
<meta property="og:url" content="{URL[idioma].format(slug)}">
<meta property="og:image" content="https://clarilium.com/assets/img/{og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="{t['ogLocale']}">
<meta name="twitter:card" content="summary_large_image">

<link rel="icon" href="{p}assets/img/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="{p}assets/img/apple-touch-icon.png">
<meta name="theme-color" content="#0c193e">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;0,900;1,700&family=Roboto:wght@400;500;700&display=swap">
<link rel="stylesheet" href="{p}assets/css/styles.css">

<!-- Tema e idioma: se aplican antes de pintar, para que no haya parpadeo -->
<script>
(function () {{
  try {{
    var tema = localStorage.getItem('clarilium-tema');
    if (tema) document.documentElement.setAttribute('data-tema', tema);
  }} catch (e) {{}}
  try {{
    var elegido = localStorage.getItem('clarilium-idioma');
    var param = new URLSearchParams(location.search).get('lang');
    if (param) {{ elegido = param; localStorage.setItem('clarilium-idioma', param); }}
    if (!elegido) {{
      var idiomas = navigator.languages || [navigator.language || ''];
      var hablaEspanol = idiomas.some(function (l) {{ return /^es/i.test(l); }});
{deteccion}
    }}
  }} catch (e) {{}}
}})();
</script>

<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "{c['titulo']}",
  "serviceType": "{c['nombre']}",
  "description": "{c['meta']}",
  "url": "{URL[idioma].format(slug)}",
  "provider": {{
    "@type": "ProfessionalService",
    "name": "CLARILIUM",
    "url": "https://clarilium.com/"
  }},
  "areaServed": "MX"
}}
</script>
</head>
<body>

<a class="saltar" href="#contenido">{t['saltar']}</a>

<div class="barra-superior">
  <div class="cintillo">
    <div class="contenedor cintillo__inner">
      <span>{t['cintillo']}</span>
      <a class="boton-cintillo" href="{casa}#{a['contacto']}">{t['cintilloBoton']}</a>
    </div>
  </div>

  <header class="sitio-header">
    <div class="contenedor sitio-header__inner">
      <button class="boton-icono nav-toggle" type="button" aria-expanded="false" aria-controls="nav-principal" aria-label="{t['abrirMenu']}"><i></i></button>

      <a class="marca" href="{casa}" aria-label="{t['marcaAria']}">
        <img src="{p}assets/img/logo-nav-color.png" alt="CLARILIUM" width="900" height="191">
      </a>

      <nav class="nav" id="nav-principal" aria-label="{t['navAria']}">
        <button class="nav-cerrar" type="button" aria-label="{t['cerrarMenu']}">&times;</button>

        <a href="{casa}#{a['inicio']}">{t['inicio']}</a>

        <div class="submenu">
          <button class="submenu__disparador" type="button" aria-expanded="false" aria-controls="submenu-servicios">
            {t['servicios']}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <ul class="submenu__lista" id="submenu-servicios">
{submenu}
          </ul>
        </div>

        <a href="{casa}#{a['nosotros']}">{t['nosotros']}</a>
        <a href="{casa}#{a['contacto']}">{t['contacto']}</a>
      </nav>

      <div class="acciones">
        <a class="boton-icono" id="btn-idioma" href="{otro}?lang={otroParam}" hreflang="{otroLang}" lang="{otroLang}"
           title="{t['idiomaTitulo']}" aria-label="{t['idiomaAria']}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3.5 9h17M3.5 15h17"/><path d="M12 3c2.3 2.4 3.4 5.4 3.4 9s-1.1 6.6-3.4 9c-2.3-2.4-3.4-5.4-3.4-9S9.7 5.4 12 3Z"/></svg>
          {t['idiomaBoton']}
        </a>

        <button class="boton-icono" id="btn-tema" type="button" aria-label="{t['temaAria']}" title="{t['temaTitulo']}">
          <svg class="icono-sol" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          <svg class="icono-luna" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/></svg>
        </button>
      </div>
    </div>
  </header>
</div>

<div class="velo" id="velo" hidden></div>

<main id="contenido">

  <div class="banda-oscura">
    <p class="franja">{t['franja']}</p>
  </div>

  <section class="banda-oscura hero">
    <a href="{casa}"><img src="{p}assets/img/{logo}" alt="{t['logoAlt']}" width="1400" height="305" fetchpriority="high"></a>
  </section>

  <section class="seccion seccion--alt">
    <div class="contenedor">
      <nav class="miga" aria-label="{t['navAria']}">
        <a href="{casa}">{t['migaInicio']}</a> <span aria-hidden="true">›</span> <span>{t['servicios']}</span> <span aria-hidden="true">›</span> <span>{c['nombre']}</span>
      </nav>

      <h1 class="centro">{c['titulo']}</h1>

      <div class="servicio-detalle">
        <div class="servicio-detalle__icono">
          <img src="{p}assets/img/{icono}" alt="{iconoAlt}" width="420" height="420">
        </div>

        <ul class="lista-servicios">
{lista}
        </ul>

        <figure class="aliado">
          <img src="{p}assets/img/aliado.webp" alt="{t['aliadoAlt']}" width="540" height="527" loading="lazy">
          <figcaption>{t['aliado']}</figcaption>
        </figure>
      </div>

      <p class="centro cta-contacto">{t['cta']}</p>
      <p class="centro"><a class="boton" href="{casa}#{a['contacto']}">{t['contacto']}</a></p>
    </div>
  </section>

</main>

<footer class="sitio-footer">
  <div class="contenedor">
    <a href="{casa}"><img src="{p}assets/img/{logo}" alt="CLARILIUM" width="1400" height="305" loading="lazy"></a>
    <p class="direccion">{t['direccion']}</p>
    <p class="legal">
      <span>&copy; <span id="anio">2026</span> CLARILIUM</span>
      <span>{t['marcas']}</span>
    </p>
  </div>
</footer>

<script>document.getElementById('anio').textContent = new Date().getFullYear();</script>
<script src="{p}assets/js/main.js" defer></script>
</body>
</html>
'''


for idioma in ('es', 'en'):
    for slug in SERVICIOS:
        destino = RAIZ / CARPETA[idioma] / f'{slug}.html'
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(pagina(idioma, slug), encoding='utf-8')
        print('escrito', destino.relative_to(RAIZ))
