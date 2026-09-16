# -*- coding: utf-8 -*-
"""Genera todas las páginas del sitio que no son la portada, y reescribe la
cabecera y el pie de la portada con el mismo molde.

La razón de que exista este script: la cabecera, la barra de navegación y el pie
deben ser idénticos en todas las páginas. Están escritos UNA sola vez, aquí, y
desde aquí se escriben en todos los archivos. Al agregar una página nueva se
agrega a este script, no se copia y pega el HTML de otra.

    python3 herramientas/generar-paginas.py

Escribe:
    index.html, en/index.html      (solo se les reemplaza la cabecera y el pie)
    servicios.html, en/services.html
    servicios/<slug>.html, en/services/<slug>.html   (abap, fiori, sapui5, cloud)
    nosotros.html, en/about.html
    contacto.html, en/contact.html
    404.html

Todas las rutas son relativas —salvo en 404.html, que se sirve desde cualquier
dirección equivocada y por eso usa rutas absolutas—, así que las páginas se
pueden revisar con doble clic desde el disco.
"""
import pathlib
import datetime
import json
import re

RAIZ = pathlib.Path(__file__).resolve().parent.parent
ANIO = datetime.date.today().year

SERVICIOS = ['abap', 'fiori', 'sapui5', 'cloud', 'btp', 'integration-suite']

ICONO = {
    'abap':             ('tec-abap.webp',  'SAP ABAP'),
    'fiori':            ('tec-fiori.webp', 'SAP Fiori'),
    'sapui5':           ('tec-ui5.webp',   'SAPUI5'),
    'cloud':            ('tec-cloud.webp', 'SAP Cloud'),
    'btp':              ('tec-btp.webp',   'SAP BTP'),
    'integration-suite': ('tec-integration-suite.webp', 'SAP Integration Suite'),
}

# Fila de tecnologías de la portada. Cada ficha lleva a la página de su servicio.
TECNOLOGIAS = [
    ('tec-btp.webp',   'SAP BTP',   'btp'),
    ('tec-cloud.webp', 'SAP Cloud', 'cloud'),
    ('tec-integration-suite.webp', 'SAP Integration Suite / CPI', 'integration-suite'),
    ('tec-fiori.webp', 'SAP Fiori', 'fiori'),
    ('tec-ui5.webp',   'SAPUI5',    'sapui5'),
    ('tec-abap.webp',  'SAP ABAP',  'abap'),
]

# ---------------------------------------------------------------- contenido --

CONTENIDO = {
    'es': {
        'abap': {
            'nombre': 'ABAP',
            'titulo': 'Servicios de Desarrollo SAP ABAP',
            'lead': 'Adaptamos y mejoramos tu sistema SAP para apoyar la continuidad y eficiencia de tu negocio.',
            'meta': 'Desarrollo SAP ABAP: fábrica de software, automatización de procesos, reportes y formularios, Recursos Humanos y Nómina, S/4HANA y optimización de rendimiento.',
            'lista': ['Fábrica de software y desarrollos a medida.',
                      'Automatización de procesos y tareas operativas.',
                      'Reportes, formularios y documentos empresariales.',
                      'Desarrollo y soporte para Recursos Humanos y Nómina.',
                      'Adaptación de desarrollos para SAP S/4HANA.',
                      'Resolución de incidencias y optimización de rendimiento.'],
        },
        'fiori': {
            'nombre': 'Fiori',
            'titulo': 'Servicios SAP Fiori',
            'lead': 'Simplificamos el trabajo de tus usuarios con aplicaciones intuitivas y accesibles.',
            'meta': 'Servicios SAP Fiori: implementación de aplicaciones, desarrollos a medida, adaptación por área, acceso móvil y soporte a la experiencia de usuario.',
            'lista': ['Implementación de aplicaciones SAP Fiori.',
                      'Aplicaciones a medida para tus procesos de negocio.',
                      'Adaptación de aplicaciones a las necesidades de cada área.',
                      'Aprobaciones y consultas desde dispositivos móviles.',
                      'Organización del acceso a aplicaciones por perfil.',
                      'Soporte y mejora de la experiencia de usuario.'],
        },
        'sapui5': {
            'nombre': 'SAPUI5',
            'titulo': 'Servicios SAPUI5',
            'lead': 'Creamos aplicaciones web conectadas con SAP y diseñadas para tu operación.',
            'meta': 'Servicios SAPUI5: aplicaciones web empresariales, portales de autoservicio, formularios digitales, paneles de seguimiento y modernización de interfaces.',
            'lista': ['Desarrollo de aplicaciones web empresariales.',
                      'Portales de autoservicio para empleados y proveedores.',
                      'Formularios digitales para captura y validación de datos.',
                      'Paneles de consulta y seguimiento operativo.',
                      'Modernización de aplicaciones e interfaces existentes.',
                      'Mantenimiento y optimización de aplicaciones SAPUI5.'],
        },
        'cloud': {
            'nombre': 'Cloud',
            'titulo': 'Servicios SAP Cloud',
            'lead': 'Acompañamos a tu empresa en la adopción y evolución de soluciones SAP en la nube.',
            'meta': 'Servicios SAP Cloud: diagnóstico y planeación, acompañamiento en migraciones, modernización de aplicaciones, conectividad, seguridad y soporte.',
            'lista': ['Diagnóstico y planeación de tu estrategia Cloud.',
                      'Acompañamiento técnico en proyectos de migración.',
                      'Modernización de aplicaciones para la nube.',
                      'Conexión de soluciones Cloud con tus sistemas actuales.',
                      'Configuración de accesos y seguridad de aplicaciones.',
                      'Soporte y optimización de soluciones en la nube.'],
        },
        'btp': {
            'nombre': 'SAP BTP',
            'titulo': 'Servicios SAP BTP',
            'lead': 'Extendemos las capacidades de SAP para responder a las necesidades de tu negocio.',
            'meta': 'Servicios SAP BTP: implementación y puesta en marcha, soluciones a medida, automatización, extensión de S/4HANA e inteligencia artificial.',
            'lista': ['Implementación y puesta en marcha de SAP BTP.',
                      'Desarrollo de soluciones empresariales a medida.',
                      'Automatización de tareas y flujos de aprobación.',
                      'Extensión de funcionalidades de SAP S/4HANA.',
                      'Incorporación de inteligencia artificial a tus procesos.',
                      'Soporte y mejora continua de soluciones BTP.'],
        },
        'integration-suite': {
            'nombre': 'SAP CPI',
            'titulo': 'Servicios SAP CPI',
            'lead': 'Conectamos SAP con tus aplicaciones y socios de negocio para reducir tareas manuales.',
            'meta': 'Servicios SAP CPI: integración con sistemas externos, conexión con clientes y proveedores, migración desde PI/PO, monitoreo y soporte de integraciones.',
            'lista': ['Integración de SAP con sistemas externos.',
                      'Conexión con clientes, proveedores y plataformas digitales.',
                      'Sincronización de información entre aplicaciones.',
                      'Automatización del intercambio de documentos y datos.',
                      'Migración de interfaces de SAP PI/PO a la nube.',
                      'Monitoreo, soporte y recuperación de integraciones.'],
        },
    },
    'en': {
        'abap': {
            'nombre': 'ABAP',
            'titulo': 'SAP ABAP Development Services',
            'lead': 'We adapt and improve your SAP system to support your business continuity and efficiency.',
            'meta': 'SAP ABAP development: software factory, process automation, reports and forms, HR and Payroll, S/4HANA and performance tuning.',
            'lista': ['Software factory and custom development.',
                      'Automation of processes and operational tasks.',
                      'Reports, forms and business documents.',
                      'Development and support for HR and Payroll.',
                      'Adaptation of developments for SAP S/4HANA.',
                      'Incident resolution and performance tuning.'],
        },
        'fiori': {
            'nombre': 'Fiori',
            'titulo': 'SAP Fiori Services',
            'lead': "We make your users' work simpler with intuitive, accessible applications.",
            'meta': 'SAP Fiori services: application rollout, custom apps, adaptation per area, mobile access and user experience support.',
            'lista': ['Rollout of SAP Fiori applications.',
                      'Custom applications for your business processes.',
                      "Adaptation of applications to each area's needs.",
                      'Approvals and lookups from mobile devices.',
                      'Application access organized by profile.',
                      'Support and improvement of the user experience.'],
        },
        'sapui5': {
            'nombre': 'SAPUI5',
            'titulo': 'SAPUI5 Services',
            'lead': 'We build web applications connected to SAP and designed around your operation.',
            'meta': 'SAPUI5 services: enterprise web applications, self-service portals, digital forms, operational dashboards and interface modernization.',
            'lista': ['Development of enterprise web applications.',
                      'Self-service portals for employees and suppliers.',
                      'Digital forms for data capture and validation.',
                      'Dashboards for lookups and operational tracking.',
                      'Modernization of existing applications and interfaces.',
                      'Maintenance and optimization of SAPUI5 applications.'],
        },
        'cloud': {
            'nombre': 'Cloud',
            'titulo': 'SAP Cloud Services',
            'lead': 'We guide your company through adopting and evolving SAP solutions in the cloud.',
            'meta': 'SAP Cloud services: assessment and planning, migration guidance, application modernization, connectivity, security and support.',
            'lista': ['Assessment and planning of your Cloud strategy.',
                      'Technical guidance on migration projects.',
                      'Modernization of applications for the cloud.',
                      'Connection of Cloud solutions with your current systems.',
                      'Configuration of application access and security.',
                      'Support and optimization of cloud solutions.'],
        },
        'btp': {
            'nombre': 'SAP BTP',
            'titulo': 'SAP BTP Services',
            'lead': "We extend SAP's capabilities to meet your business needs.",
            'meta': 'SAP BTP services: implementation and rollout, tailored solutions, automation, S/4HANA extensions and artificial intelligence.',
            'lista': ['Implementation and rollout of SAP BTP.',
                      'Development of tailored enterprise solutions.',
                      'Automation of tasks and approval flows.',
                      'Extension of SAP S/4HANA functionality.',
                      'Adding artificial intelligence to your processes.',
                      'Support and continuous improvement of BTP solutions.'],
        },
        'integration-suite': {
            'nombre': 'SAP CPI',
            'titulo': 'SAP CPI Services',
            'lead': 'We connect SAP with your applications and business partners to cut down manual work.',
            'meta': 'SAP CPI services: integration with external systems, connection with customers and suppliers, migration from PI/PO, monitoring and support.',
            'lista': ['Integration of SAP with external systems.',
                      'Connection with customers, suppliers and digital platforms.',
                      'Synchronization of information between applications.',
                      'Automation of document and data exchange.',
                      'Migration of interfaces from SAP PI/PO to the cloud.',
                      'Monitoring, support and recovery of integrations.'],
        },
    },
}

# Página índice de servicios, con el texto que estaba en la portada
INDICE = {
    'es': {
        'titulo': 'Servicios de Fábrica de Software',
        'meta': 'Fábrica de Software ABAP, Fiori, SAPUI5 y SAP Cloud. Un enfoque integral y personalizado para maximizar el potencial de sus soluciones SAP.',
        'parrafos': [
            'Ofrecemos un enfoque integral y personalizado para ayudar a su empresa a maximizar el potencial de las soluciones SAP.',
            'Somos un equipo de expertos altamente capacitados.',
            'Brindamos servicios en las tecnologías más avanzadas del ecosistema SAP.',
            'Expertos en optimizar procesos, mejorar la productividad y acelerar la innovación en su organización.',
            'Comprometidos a brindarle soluciones estratégicas que impulsen su negocio hacia el éxito digital.',
        ],
        'fotoAlt': 'Equipo de consultores de CLARILIUM',
        'cta': 'Para mayor información, haga clic en el botón de Contacto',
    },
    'en': {
        'titulo': 'Software Factory Services',
        'meta': 'ABAP, Fiori, SAPUI5 and SAP Cloud software factory. A comprehensive, personalized approach to get the most out of your SAP solutions.',
        'parrafos': [
            'We offer a comprehensive, personalized approach to help your company make the most of SAP solutions.',
            'We are a team of highly trained experts.',
            'We provide services across the most advanced technologies of the SAP ecosystem.',
            'Experts at optimizing processes, improving productivity and accelerating innovation in your organization.',
            'Committed to delivering strategic solutions that drive your business towards digital success.',
        ],
        'fotoAlt': 'CLARILIUM consulting team',
        'cta': 'For more information, click the Contact button',
    },
}

NOSOTROS = {
    'es': {
        'titulo': 'Nosotros',
        'meta': 'Más de 18 años de trayectoria como equipo de expertos en SAP. CLARILIUM viene de Clarus Consilium: ideas claras.',
        'bloques': [
            ('CLARILIUM',
             'De la experiencia de nuestras ideas claras hacia nuestros clientes, surge la idea de juntar las palabras <strong>Clarus Consilium (Ideas claras)</strong> en una sola frase que nos represente: <strong>CLARILIUM</strong>.'),
            ('¿Quiénes somos?',
             'Más de <span data-anios>18</span> años de trayectoria nos respaldan como equipo de expertos apasionados por ayudar a las organizaciones a optimizar sus procesos de negocio mediante ideas claras plasmadas en soluciones innovadoras.'),
            ('Historia',
             'Nuestra experiencia a través de los años y estrechas relaciones con consultores de vasta experiencia, ha resultado en la unión de grandes talentos por petición de las empresas a las que hemos dado servicios, formando así nuestra familia <strong>CLARILIUM</strong>.'),
        ],
        'fotoAlt': 'Equipo de CLARILIUM',
        'boton': 'Contáctanos',
    },
    'en': {
        'titulo': 'About us',
        'meta': 'More than 18 years of track record as a team of SAP experts. CLARILIUM comes from Clarus Consilium: clear ideas.',
        'bloques': [
            ('CLARILIUM',
             'From the experience of our clear ideas towards our clients came the idea of joining the words <strong>Clarus Consilium (clear ideas)</strong> into a single phrase that represents us: <strong>CLARILIUM</strong>.'),
            ('Who we are',
             'More than <span data-anios>18</span> years of track record back us as a team of experts passionate about helping organizations optimize their business processes through clear ideas turned into innovative solutions.'),
            ('Our story',
             'Our experience over the years and close relationships with highly experienced consultants brought together great talent at the request of the companies we have served, forming our <strong>CLARILIUM</strong> family.'),
        ],
        'fotoAlt': 'The CLARILIUM team',
        'boton': 'Contact us',
    },
}

CONTACTO = {
    'es': {
        'titulo': 'Contacto',
        'meta': 'Escríbenos y te contactamos muy pronto. Oficina en Real del Valle, Mazatlán, Sinaloa.',
        'enviando': 'Enviando…',
        'ok': 'Gracias. Recibimos tu mensaje y te contactamos muy pronto.',
        'error': 'No pudimos enviar el mensaje. Por favor inténtalo de nuevo en unos minutos.',
        'limite': 'Recibimos varios mensajes tuyos hace poco. Espera unos minutos antes de enviar otro.',
        'nombre': 'Nombre(s) y apellido(s)',
        'correo': 'Correo electrónico',
        'empresa': 'Empresa',
        'telefono': 'Teléfono',
        'mensaje': '¿En qué te ayudamos?',
        'trampa': 'No llenar este campo',
        'enviar': 'Enviar',
        'notaLegal': 'Usamos tus datos únicamente para responder tu solicitud.',
    },
    'en': {
        'titulo': 'Contact',
        'meta': 'Write to us and we will get back to you shortly. Office in Real del Valle, Mazatlán, Sinaloa.',
        'enviando': 'Sending…',
        'ok': 'Thank you. We received your message and will get back to you shortly.',
        'error': 'We could not send your message. Please try again in a few minutes.',
        'limite': 'We received several messages from you a moment ago. Please wait a few minutes before sending another.',
        'nombre': 'First and last name',
        'correo': 'Email',
        'empresa': 'Company',
        'telefono': 'Phone',
        'mensaje': 'How can we help?',
        'trampa': 'Do not fill this field',
        'enviar': 'Send',
        'notaLegal': 'We use your details only to answer your request.',
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
        'desplegarServicios': 'Mostrar los servicios',
        'idiomaBoton': 'EN', 'idiomaTitulo': 'Switch to English', 'idiomaAria': 'Cambiar a inglés',
        'temaAria': 'Cambiar entre modo claro y oscuro', 'temaTitulo': 'Modo claro / oscuro',
        'franja': 'Fábrica de Software ABAP, Fiori y SAP Cloud',
        'logoAlt': 'CLARILIUM — Ideas claras, soluciones claras',
        'aliado': 'Estamos aquí para ser su mejor aliado',
        'aliadoAlt': 'Consultores de CLARILIUM',
        'cta': 'Para mayor información, haga clic en el botón de Contacto',
        'direccion': 'Avenida de las Torres Coto 16, Real del Valle,<br>Mazatlán, Sinaloa, México, CP 82124',
        'marcas': 'SAP, ABAP, Fiori, SAPUI5 y SAP BTP son marcas registradas de SAP SE',
        'error404': 'Esta página no existe',
        'error404txt': 'Puede que el enlace esté mal escrito o que la página haya cambiado de lugar.',
        'error404btn': 'Ir al inicio',
    },
    'en': {
        'htmlLang': 'en', 'ogLocale': 'en_US',
        'saltar': 'Skip to main content',
        'cintillo': 'We have the best rates and service on the market!',
        'cintilloBoton': 'More information',
        'abrirMenu': 'Open menu', 'cerrarMenu': 'Close menu',
        'navAria': 'Main navigation', 'marcaAria': 'CLARILIUM — home',
        'inicio': 'Home', 'servicios': 'Services', 'nosotros': 'About', 'contacto': 'Contact',
        'desplegarServicios': 'Show services',
        'idiomaBoton': 'ES', 'idiomaTitulo': 'Cambiar a español', 'idiomaAria': 'Switch to Spanish',
        'temaAria': 'Switch between light and dark mode', 'temaTitulo': 'Light / dark mode',
        'franja': 'ABAP, Fiori and SAP Cloud Software Factory',
        'logoAlt': 'CLARILIUM — Clear ideas, clear solutions',
        'aliado': 'We are here to be your best ally',
        'aliadoAlt': 'CLARILIUM consultants',
        'cta': 'For more information, click the Contact button',
        'direccion': 'Avenida de las Torres Coto 16, Real del Valle,<br>Mazatlán, Sinaloa, Mexico, postal code 82124',
        'marcas': 'SAP, ABAP, Fiori, SAPUI5 and SAP BTP are registered trademarks of SAP SE',
        'error404': 'This page does not exist',
        'error404txt': 'The link may be mistyped or the page may have moved.',
        'error404btn': 'Go to the home page',
    },
}

ANCLA = {'es': {'inicio': 'inicio', 'nosotros': 'nosotros', 'contacto': 'contacto'},
         'en': {'inicio': 'home',   'nosotros': 'about',    'contacto': 'contact'}}

# Dirección oficial del sitio. Se usa en las etiquetas canónicas, hreflang,
# Open Graph y datos estructurados. Si algún día cambia el dominio, se cambia
# aquí y se vuelve a correr este script: es el único lugar donde está escrito.
SITIO = 'https://www.clarilium.com'

URL_SERVICIO = {'es': SITIO + '/servicios/{}',
                'en': SITIO + '/en/services/{}'}
URL_INDICE = {'es': SITIO + '/servicios',
              'en': SITIO + '/en/services'}

# Dónde vive cada página del menú. Todos los enlaces del sitio salen de aquí,
# así que para mover o renombrar una página basta con cambiarla en este mapa.
ARCHIVO = {
    'es': {'inicio': 'index.html', 'servicios': 'servicios.html',
           'nosotros': 'nosotros.html', 'contacto': 'contacto.html'},
    'en': {'inicio': 'en/index.html', 'servicios': 'en/services.html',
           'nosotros': 'en/about.html', 'contacto': 'en/contact.html'},
}
URL_PAGINA = {
    'es': {'nosotros': SITIO + '/nosotros', 'contacto': SITIO + '/contacto'},
    'en': {'nosotros': SITIO + '/en/about', 'contacto': SITIO + '/en/contact'},
}


def enlace(idioma, p, destino):
    """p es la ruta a la raíz del sitio desde la página que se está escribiendo."""
    return p + ARCHIVO[idioma][destino]


# ------------------------------------------------------- cabecera y pie ------
# Escritos una sola vez. Todas las páginas los reciben de aquí.

def cabecera(idioma, p, otro, otroParam, activo=None):
    """p: ruta a la raíz del sitio desde la página que se está escribiendo.
    activo: 'inicio', 'servicios', 'nosotros', 'contacto' o el slug de un servicio."""
    t = TEXTOS[idioma]
    base = 'servicios' if idioma == 'es' else 'en/services'
    otroLang = 'en' if idioma == 'es' else 'es-mx'

    filas = []
    for s in SERVICIOS:
        marca = ' aria-current="page"' if s == activo else ''
        filas.append(f'            <li><a href="{p}{base}/{s}.html"{marca}>{CONTENIDO[idioma][s]["nombre"]}</a></li>')
    submenu = '\n'.join(filas)

    def marca(nombre):
        if nombre == 'servicios':
            return ' aria-current="page"' if activo in (['servicios'] + SERVICIOS) else ''
        return ' aria-current="page"' if activo == nombre else ''

    return f'''<a class="saltar" href="#contenido">{t['saltar']}</a>

<div class="barra-superior">
  <div class="cintillo">
    <div class="contenedor cintillo__inner">
      <span>{t['cintillo']}</span>
      <a class="boton-cintillo" href="{enlace(idioma, p, 'contacto')}">{t['cintilloBoton']}</a>
    </div>
  </div>

  <header class="sitio-header">
    <div class="contenedor sitio-header__inner">
      <button class="boton-icono nav-toggle" type="button" aria-expanded="false" aria-controls="nav-principal" aria-label="{t['abrirMenu']}"><i></i></button>

      <a class="marca" href="{enlace(idioma, p, 'inicio')}" aria-label="{t['marcaAria']}">
        <img src="{p}assets/img/logo-nav-color.png" alt="CLARILIUM" width="900" height="191">
      </a>

      <nav class="nav" id="nav-principal" aria-label="{t['navAria']}">
        <button class="nav-cerrar" type="button" aria-label="{t['cerrarMenu']}">&times;</button>

        <a href="{enlace(idioma, p, 'inicio')}"{marca('inicio')}>{t['inicio']}</a>

        <div class="submenu">
          <a class="submenu__disparador" href="{p}{base}.html"{marca('servicios')}>{t['servicios']}</a>
          <button class="submenu__flecha" type="button" aria-expanded="false" aria-controls="submenu-servicios" aria-label="{t['desplegarServicios']}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
          </button>
          <ul class="submenu__lista" id="submenu-servicios">
{submenu}
          </ul>
        </div>

        <a href="{enlace(idioma, p, 'nosotros')}"{marca('nosotros')}>{t['nosotros']}</a>
        <a href="{enlace(idioma, p, 'contacto')}"{marca('contacto')}>{t['contacto']}</a>
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

<div class="velo" id="velo" hidden></div>'''


def pie(idioma, p):
    t = TEXTOS[idioma]
    logo = 'logo-hero.png' if idioma == 'es' else 'logo-hero-en.png'
    return f'''<footer class="sitio-footer">
  <div class="contenedor">
    <a href="{enlace(idioma, p, 'inicio')}"><img src="{p}assets/img/{logo}" alt="CLARILIUM" width="1400" height="305" loading="lazy"></a>
    <p class="direccion">{t['direccion']}</p>
    <p class="legal">
      <span>&copy; <span id="anio">{ANIO}</span> CLARILIUM</span>
      <span>{t['marcas']}</span>
    </p>
  </div>
</footer>'''


SCRIPT_TEMA = """(function () {
  var raiz = document.documentElement;
  try {
    var tema = localStorage.getItem('clarilium-tema');
    if (tema) raiz.setAttribute('data-tema', tema);
  } catch (e) {}
  try {
    var otro = raiz.getAttribute('data-otro');
    if (otro) {
      var esEspanol = raiz.getAttribute('data-idioma') === 'es';
      var elegido = localStorage.getItem('clarilium-idioma');
      var param = new URLSearchParams(location.search).get('lang');
      if (param) { elegido = param; localStorage.setItem('clarilium-idioma', param); }
      if (!elegido) {
        var idiomas = navigator.languages || [navigator.language || ''];
        var hablaEspanol = idiomas.some(function (l) { return /^es/i.test(l); });
        if (hablaEspanol !== esEspanol) location.replace(otro);
      } else if (elegido !== (esEspanol ? 'es' : 'en')) {
        location.replace(otro);
      }
    }
  } catch (e) {}
})();"""


def hash_csp():
    """Hash del bloque en linea, tal como queda dentro de <script>...</script>."""
    import base64, hashlib
    contenido = '\n' + SCRIPT_TEMA + '\n'
    return 'sha256-' + base64.b64encode(hashlib.sha256(contenido.encode('utf-8')).digest()).decode()


def encabezado_html(idioma, p, titulo, meta, canonical, alt_es, alt_en, og, otro):
    t = TEXTOS[idioma]
    return f'''<!DOCTYPE html>
<html lang="{t['htmlLang']}" data-idioma="{idioma}" data-otro="{otro}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{titulo}</title>
<meta name="description" content="{meta}">
<link rel="canonical" href="{canonical}">
<link rel="alternate" hreflang="es-mx" href="{alt_es}">
<link rel="alternate" hreflang="en" href="{alt_en}">
<link rel="alternate" hreflang="x-default" href="{alt_es}">

<meta property="og:type" content="website">
<meta property="og:site_name" content="CLARILIUM">
<meta property="og:title" content="{titulo}">
<meta property="og:description" content="{meta}">
<meta property="og:url" content="{canonical}">
<meta property="og:image" content="{SITIO}/assets/img/{og}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:locale" content="{t['ogLocale']}">
<meta name="twitter:card" content="summary_large_image">

<link rel="icon" href="{p}assets/img/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="{p}assets/img/apple-touch-icon.png">
<meta name="theme-color" content="#040814">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;0,900;1,700&family=Roboto:wght@400;500;700&display=swap">
<link rel="stylesheet" href="{p}assets/css/styles.css">

<!-- Tema e idioma: se aplican antes de pintar, para que no haya parpadeo -->
<script>
{SCRIPT_TEMA}
</script>'''



CIERRE = '''<script src="{p}assets/js/main.js" defer></script>
</body>
</html>
'''


# ------------------------------------------------------------- las páginas --

def franja_y_hero(idioma, p, comoH1=False):
    t = TEXTOS[idioma]
    logo = 'logo-hero.png' if idioma == 'es' else 'logo-hero-en.png'
    et = 'h1' if comoH1 else 'p'
    return f'''  <div class="banda-oscura">
    <{et} class="franja">{t['franja']}</{et}>
  </div>

  <section class="banda-oscura hero">
    <a href="{enlace(idioma, p, 'inicio')}"><img src="{p}assets/img/{logo}" alt="{t['logoAlt']}" width="1400" height="305" fetchpriority="high"></a>
  </section>'''


def pagina_servicio(idioma, slug):
    t, c = TEXTOS[idioma], CONTENIDO[idioma][slug]
    p = '../' if idioma == 'es' else '../../'
    otro = (f'../en/services/{slug}.html' if idioma == 'es' else f'../../servicios/{slug}.html')
    otroParam = 'en' if idioma == 'es' else 'es'
    icono, iconoAlt = ICONO[slug]
    og = 'og-es.png' if idioma == 'es' else 'og-en.png'
    base = 'servicios' if idioma == 'es' else 'en/services'
    lista = '\n'.join(f'          <li>{x}</li>' for x in c['lista'])
    # Con muchos puntos la columna se vuelve larguísima: se parte en dos.
    claseLista = 'lista-servicios lista-servicios--larga' if len(c['lista']) > 8 else 'lista-servicios'

    cuerpo = f'''{franja_y_hero(idioma, p)}

  <section class="seccion seccion--alt">
    <div class="contenedor">
      <h1 class="centro">{c['titulo']}</h1>
      <p class="centro entrada">{c['lead']}</p>

      <div class="servicio-detalle">
        <div class="servicio-detalle__icono">
          <img src="{p}assets/img/{icono}" alt="{iconoAlt}" width="420" height="420">
        </div>

        <ul class="{claseLista}">
{lista}
        </ul>

        <figure class="aliado">
          <img src="{p}assets/img/aliado.webp" alt="{t['aliadoAlt']}" width="540" height="527" loading="lazy">
          <figcaption>{t['aliado']}</figcaption>
        </figure>
      </div>

      <p class="centro cta-contacto">{t['cta']}</p>
      <p class="centro"><a class="boton" href="{enlace(idioma, p, 'contacto')}">{t['contacto']}</a></p>
    </div>
  </section>'''

    jsonld = f'''<script type="application/ld+json">
{{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "{c['titulo']}",
  "serviceType": "{c['nombre']}",
  "description": "{c['meta']}",
  "url": "{URL_SERVICIO[idioma].format(slug)}",
  "provider": {{ "@type": "ProfessionalService", "name": "CLARILIUM", "url": "{SITIO}/" }},
  "areaServed": "MX"
}}
</script>'''

    return (encabezado_html(idioma, p, f"{c['titulo']} — CLARILIUM", c['meta'],
                            URL_SERVICIO[idioma].format(slug),
                            URL_SERVICIO['es'].format(slug), URL_SERVICIO['en'].format(slug),
                            og, otro)
            + '\n\n' + jsonld + '\n</head>\n<body>\n\n'
            + cabecera(idioma, p, otro, otroParam, activo=slug)
            + '\n\n<main id="contenido">\n\n' + cuerpo + '\n\n</main>\n\n'
            + pie(idioma, p) + '\n\n' + CIERRE.replace('{p}', p))


def pagina_indice(idioma):
    t, c = TEXTOS[idioma], INDICE[idioma]
    p = '' if idioma == 'es' else '../'
    otro = 'en/services.html' if idioma == 'es' else '../servicios.html'
    otroParam = 'en' if idioma == 'es' else 'es'
    og = 'og-es.png' if idioma == 'es' else 'og-en.png'
    base = 'servicios' if idioma == 'es' else 'en/services'

    parrafos = '\n'.join(f'          <p>{x}</p>' for x in c['parrafos'])
    fichas = '\n'.join(
        f'''        <a class="ficha" href="{p}{base}/{s}.html">
          <img src="{p}assets/img/{ICONO[s][0]}" alt="{ICONO[s][1]}" width="420" height="420" loading="lazy">
        </a>''' for s in SERVICIOS)

    cuerpo = f'''{franja_y_hero(idioma, p)}

  <section class="seccion">
    <div class="contenedor">
      <h1 class="centro">{c['titulo']}</h1>

      <div class="servicios__grid">
        <div class="servicios__texto">
{parrafos}
        </div>
        <div>
          <img src="{p}assets/img/servicios.webp" alt="{c['fotoAlt']}" width="900" height="900" loading="lazy">
        </div>
      </div>
    </div>
  </section>

  <div class="banda-oscura fichas-banda">
    <div class="contenedor">
      <div class="fichas">
{fichas}
      </div>
    </div>
  </div>

  <section class="seccion">
    <div class="contenedor">
      <p class="centro">{c['cta']}</p>
      <p class="centro"><a class="boton" href="{enlace(idioma, p, 'contacto')}">{t['contacto']}</a></p>
    </div>
  </section>'''

    return (encabezado_html(idioma, p, f"{c['titulo']} — CLARILIUM", c['meta'],
                            URL_INDICE[idioma], URL_INDICE['es'], URL_INDICE['en'],
                            og, otro)
            + '\n</head>\n<body>\n\n'
            + cabecera(idioma, p, otro, otroParam, activo='servicios')
            + '\n\n<main id="contenido">\n\n' + cuerpo + '\n\n</main>\n\n'
            + pie(idioma, p) + '\n\n' + CIERRE.replace('{p}', p))


def pagina_nosotros(idioma):
    t, c = TEXTOS[idioma], NOSOTROS[idioma]
    p = '' if idioma == 'es' else '../'
    otro = 'en/about.html' if idioma == 'es' else '../nosotros.html'
    otroParam = 'en' if idioma == 'es' else 'es'
    og = 'og-es.png' if idioma == 'es' else 'og-en.png'

    bloques = '\n\n'.join(f'          <h2>{h}</h2>\n          <p>{x}</p>' for h, x in c['bloques'])

    cuerpo = f"""{franja_y_hero(idioma, p)}

  <section class="seccion">
    <div class="contenedor">
      <h1 class="centro">{c['titulo']}</h1>

      <div class="nosotros__grid">
        <div>
{bloques}
        </div>

        <div class="nosotros__figura centro">
          <img src="{p}assets/img/equipo.webp" alt="{c['fotoAlt']}" width="1200" height="567" loading="lazy">
          <a class="boton" href="{enlace(idioma, p, 'contacto')}">{c['boton']}</a>
        </div>
      </div>
    </div>
  </section>"""

    return (encabezado_html(idioma, p, f"{c['titulo']} — CLARILIUM", c['meta'],
                            URL_PAGINA[idioma]['nosotros'],
                            URL_PAGINA['es']['nosotros'], URL_PAGINA['en']['nosotros'],
                            og, otro)
            + '\n</head>\n<body>\n\n'
            + cabecera(idioma, p, otro, otroParam, activo='nosotros')
            + '\n\n<main id="contenido">\n\n' + cuerpo + '\n\n</main>\n\n'
            + pie(idioma, p) + '\n\n' + CIERRE.replace('{p}', p))


def pagina_contacto(idioma):
    t, c = TEXTOS[idioma], CONTACTO[idioma]
    p = '' if idioma == 'es' else '../'
    otro = 'en/contact.html' if idioma == 'es' else '../contacto.html'
    otroParam = 'en' if idioma == 'es' else 'es'
    og = 'og-es.png' if idioma == 'es' else 'og-en.png'

    cuerpo = f"""{franja_y_hero(idioma, p)}

  <section class="seccion banda-oscura">
    <div class="contenedor">
      <h1 class="centro">{c['titulo']}</h1>

      <div class="contacto__grid">
        <form class="formulario" id="form-contacto" novalidate
              data-texto-enviando="{c['enviando']}"
              data-texto-ok="{c['ok']}"
              data-texto-error="{c['error']}"
              data-texto-limite="{c['limite']}">

          <div class="aviso" id="form-aviso" hidden></div>

          <div class="campo">
            <label for="nombre">{c['nombre']} <span class="req">*</span></label>
            <input type="text" id="nombre" name="nombre" required autocomplete="name" maxlength="80">
          </div>

          <div class="campo">
            <label for="correo">{c['correo']} <span class="req">*</span></label>
            <input type="email" id="correo" name="correo" required autocomplete="email" maxlength="120">
          </div>

          <div class="campo--par">
            <div class="campo">
              <label for="empresa">{c['empresa']}</label>
              <input type="text" id="empresa" name="empresa" autocomplete="organization" maxlength="80">
            </div>
            <div class="campo">
              <label for="telefono">{c['telefono']}</label>
              <input type="tel" id="telefono" name="telefono" autocomplete="tel" maxlength="30">
            </div>
          </div>

          <div class="campo">
            <label for="mensaje">{c['mensaje']} <span class="req">*</span></label>
            <textarea id="mensaje" name="mensaje" required maxlength="2000"></textarea>
          </div>

          <div class="trampa" aria-hidden="true">
            <label for="sitioWeb">{c['trampa']}</label>
            <input type="text" id="sitioWeb" name="sitioWeb" tabindex="-1" autocomplete="off">
          </div>

          <button class="boton" type="submit">{c['enviar']}</button>
          <p class="nota-legal">{c['notaLegal']}</p>
        </form>

        <div>
          <img src="{p}assets/img/contacto.webp" alt="" width="600" height="600" loading="lazy">
        </div>
      </div>
    </div>
  </section>"""

    return (encabezado_html(idioma, p, f"{c['titulo']} — CLARILIUM", c['meta'],
                            URL_PAGINA[idioma]['contacto'],
                            URL_PAGINA['es']['contacto'], URL_PAGINA['en']['contacto'],
                            og, otro)
            + '\n</head>\n<body>\n\n'
            + cabecera(idioma, p, otro, otroParam, activo='contacto')
            + '\n\n<main id="contenido">\n\n' + cuerpo + '\n\n</main>\n\n'
            + pie(idioma, p) + '\n\n' + CIERRE.replace('{p}', p))


def pagina_404():
    """Se sirve desde cualquier URL equivocada, así que usa rutas absolutas."""
    t, te = TEXTOS['es'], TEXTOS['en']
    p = '/'
    cab = cabecera('es', p, '/en/index.html', 'en')
    return f'''<!DOCTYPE html>
<html lang="es-MX" data-idioma="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Página no encontrada — CLARILIUM</title>
<meta name="robots" content="noindex">

<link rel="icon" href="/assets/img/favicon-32.png" sizes="32x32">
<meta name="theme-color" content="#040814">

<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,400;0,700;0,900;1,700&family=Roboto:wght@400;500;700&display=swap">
<link rel="stylesheet" href="/assets/css/styles.css">

<script>
{SCRIPT_TEMA}
</script>
</head>
<body>

{cab}

<main id="contenido">

{franja_y_hero('es', p)}

  <section class="seccion error">
    <div class="contenedor">
      <p class="error__codigo">404</p>
      <h1>{t['error404']}</h1>
      <p>{t['error404txt']}</p>
      <a class="boton" href="/">{t['error404btn']}</a>

      <p class="error__en" lang="en">
        <strong>Page not found.</strong> {te['error404txt']}
        <a href="/en/">{te['error404btn']}</a>.
      </p>
    </div>
  </section>

</main>

{pie('es', p)}

{CIERRE.replace('{p}', p)}'''


# ------------------------------------------- reescritura de las portadas ----

def sincronizar_portada(ruta, idioma, p, otro, otroParam):
    """Reemplaza la cabecera y el pie de la portada por los de este molde, para
    que nunca se separen de los del resto de las páginas."""
    archivo = RAIZ / ruta
    s = archivo.read_text(encoding='utf-8')

    nueva = cabecera(idioma, p, otro, otroParam, activo='inicio')
    patron = re.compile(r'<a class="saltar".*?<div class="velo" id="velo" hidden></div>', re.S)
    assert patron.search(s), f'no se encontró la cabecera en {ruta}'
    s = patron.sub(lambda _: nueva, s, count=1)

    # El <html> lleva los datos que antes iban dentro del script en linea.
    s = re.sub(r'<html lang="[^"]*"[^>]*>',
               f'<html lang="{TEXTOS[idioma]["htmlLang"]}" data-idioma="{idioma}" data-otro="{otro}">',
               s, count=1)

    # El bloque de tema e idioma debe ser identico en todas las paginas: de eso
    # depende que la CSP pueda autorizarlo con un solo hash.
    patronTema = re.compile(
        r'<script>\s*\(function \(\) \{\s*(?:var raiz|try \{\s*var tema).*?\}\)\(\);\s*</script>',
        re.S)
    assert patronTema.search(s), f'no se encontro el script de tema en {ruta}'
    s = patronTema.sub(lambda _: '<script>\n' + SCRIPT_TEMA + '\n</script>', s, count=1)

    # El script del anio vive ahora en main.js
    s = s.replace(
        "<script>document.getElementById('anio').textContent = new Date().getFullYear();</script>\n", '')

    nuevoPie = pie(idioma, p)
    patronPie = re.compile(r'<footer class="sitio-footer">.*?</footer>', re.S)
    assert patronPie.search(s), f'no se encontró el pie en {ruta}'
    s = patronPie.sub(lambda _: nuevoPie, s, count=1)

    archivo.write_text(s, encoding='utf-8')
    print('sincronizado', ruta)


def actualizar_csp():
    """Escribe en staticwebapp.config.json el hash del script en linea.
    Asi la CSP y las paginas no pueden quedar desalineadas."""
    archivo = RAIZ / 'staticwebapp.config.json'
    conf = json.loads(archivo.read_text(encoding='utf-8'))
    csp = conf['globalHeaders']['Content-Security-Policy']
    partes = []
    for directiva in csp.split(';'):
        d = directiva.strip()
        if d.startswith('script-src'):
            d = f"script-src 'self' '{hash_csp()}'"
        partes.append(d)
    conf['globalHeaders']['Content-Security-Policy'] = '; '.join(x for x in partes if x)
    archivo.write_text(json.dumps(conf, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('CSP actualizada con', hash_csp())


if __name__ == '__main__':
    for idioma in ('es', 'en'):
        for slug in SERVICIOS:
            carpeta = 'servicios' if idioma == 'es' else 'en/services'
            destino = RAIZ / carpeta / f'{slug}.html'
            destino.parent.mkdir(parents=True, exist_ok=True)
            destino.write_text(pagina_servicio(idioma, slug), encoding='utf-8')
            print('escrito', destino.relative_to(RAIZ))

    (RAIZ / 'servicios.html').write_text(pagina_indice('es'), encoding='utf-8')
    print('escrito servicios.html')
    (RAIZ / 'en' / 'services.html').write_text(pagina_indice('en'), encoding='utf-8')
    print('escrito en/services.html')

    (RAIZ / 'nosotros.html').write_text(pagina_nosotros('es'), encoding='utf-8')
    (RAIZ / 'en' / 'about.html').write_text(pagina_nosotros('en'), encoding='utf-8')
    print('escrito nosotros.html y en/about.html')

    (RAIZ / 'contacto.html').write_text(pagina_contacto('es'), encoding='utf-8')
    (RAIZ / 'en' / 'contact.html').write_text(pagina_contacto('en'), encoding='utf-8')
    print('escrito contacto.html y en/contact.html')

    (RAIZ / '404.html').write_text(pagina_404(), encoding='utf-8')
    print('escrito 404.html')

    sincronizar_portada('index.html', 'es', '', 'en/index.html', 'en')
    sincronizar_portada('en/index.html', 'en', '../', '../index.html', 'es')

    actualizar_csp()
