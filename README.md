# clarilium.com

Sitio público de CLARILIUM. Sitio estático (HTML + CSS + JS, sin framework ni
paso de compilación) con una función de Azure para el formulario de contacto.

## Estructura

```
index.html                  Portada en español (idioma por defecto)
en/index.html               Portada en inglés
servicios.html              Índice de servicios en español
en/services.html            El mismo en inglés
nosotros.html               Nosotros · en/about.html en inglés
contacto.html               Contacto, con el formulario · en/contact.html en inglés
servicios/<slug>.html       Páginas de servicio: abap, fiori, sapui5, cloud,
                            btp, integration-suite
en/services/<slug>.html     Las mismas en inglés
herramientas/               Scripts que generan las páginas y el logo en inglés
404.html                    Página de error, bilingüe
assets/css/styles.css       Estilos. La paleta y las tipografías están en variables CSS
assets/js/main.js           Menú, animaciones y envío del formulario
assets/img/                 Logos, fotos optimizadas (WebP) y favicons
api/                        Azure Function del formulario de contacto
staticwebapp.config.json    Rutas, cabeceras de seguridad y caché
robots.txt, sitemap.xml     SEO
```

## Flujo de trabajo

```
rama dev  →  Pull Request  →  URL de preview automática  →  merge a main  →  producción
```

Nunca se hace push directo a `main`: todo cambio pasa por un PR y se revisa en su
URL de preview antes de publicarse.

## Cambiar la tipografía

Están declaradas en dos variables al inicio de `assets/css/styles.css`:

```css
--font-display: "Lato", ...;    /* títulos, botones, números */
--font-text:    "Roboto", ...;  /* texto corrido */
```

La escala de tamaños también está en variables: `--t-48`, `--t-24`, `--t-18`,
`--t-16`, `--t-14`, `--t-12`.

Al cambiarlas hay que actualizar también el `<link>` de Google Fonts en el `<head>`
de `index.html` y de `en/index.html`.

## Idioma y tema

**Idioma.** El sitio se sirve en español en `/` y en inglés en `/en/`. Un script
en el `<head>` decide al cargar:

1. Si el visitante ya eligió idioma con el botón, se respeta esa elección
   (guardada en `localStorage`).
2. Si no, se mira `navigator.languages`: si no habla español, se le manda a `/en/`.
3. `?lang=es` o `?lang=en` fuerza un idioma y lo recuerda.

**Tema.** Arranca con la preferencia del sistema (`prefers-color-scheme`) y el
botón de sol/luna la cambia, guardando la elección en `localStorage`. En el CSS
el tema vive en el atributo `data-tema` de `<html>` (`claro` u `oscuro`).

## Logotipo

| Archivo | Uso |
|---|---|
| `logo-hero.png` | Logo grande en color con el eslogan en español. Portada, páginas de servicio y pie |
| `logo-hero-en.png` | El mismo, con el eslogan **CLEAR IDEAS, CLEAR SOLUTIONS**. Solo en `/en/` |
| `logo-nav-color.png` | Versión en color sin eslogan, para la barra de navegación |
| `og-es.png` / `og-en.png` | Imagen de vista previa para redes sociales, 1200×630 sobre el azul noche |

La versión en inglés no se volvió a componer con una tipografía parecida: se
armó recortando los glifos del propio `sloganColor.png`, así que las letras son
exactamente las mismas. La única letra que no existe en el eslogan español es la
**T**, y se construyó con la barra superior de la **E** y el asta de la **I**.

## Ancho de la página

`--ancho` vale **1400px**. Con el aire de `--gutter` a cada lado, en un monitor
de 1440 quedan ~1330px de contenido, prácticamente lo mismo que el sitio
original (1366px). De ahí para arriba el contenido ya no crece: una columna de
texto más ancha deja de leerse bien, mientras que el sitio original sigue
estirándose hasta el borde.

Los gráficos van proporcionados a ese ancho y todos son relativos, así que se
encogen solos: el logotipo del encabezado `min(880px, 88%)`, las imágenes de
Misión / Visión / Propósito `min(420px, 94%)`, la figura de la metodología
`min(420px, 82%)` y el logotipo del pie `min(420px, 70%)`.

La escala tipográfica también respira: `--t-48` y `--t-24` son `clamp()`, así que
crecen con la pantalla y se encogen en móvil.

## Barra superior

A diferencia del resto de la página, la barra de navegación **no se limita al
ancho del contenedor**: el logotipo va pegado a la izquierda y el menú pegado a
la derecha, como en el sitio original. Lo hace `.sitio-header__inner`, que anula
el `max-width` de `.contenedor`.

"Servicios" son dos controles: el texto es un enlace a `servicios.html` y la
flecha de al lado (`.submenu__flecha`) abre y cierra el desplegable. En
escritorio el desplegable también se abre al pasar el puntero; en móvil, donde no
hay hover, la flecha es la única forma de abrirlo y el texto navega.

El desplegable tiene un puente invisible (`.submenu__lista::before`) que cubre el
espacio entre el botón y la lista. Sin él, al bajar el puntero se perdía el
`:hover` a medio camino y el menú se cerraba antes de poder elegir una opción.

## Barra superior fija

El cintillo se parte en dos líneas en pantallas angostas, así que la barra mide
~113 px en escritorio y ~168 px en móvil. `main.js` mide su altura real y la
publica en la variable CSS `--alto-barra`, que el CSS usa como
`scroll-padding-top`. Así los saltos a sección nunca quedan tapados por la barra.

## Años de experiencia

No están escritos a mano. `assets/js/main.js` los calcula contra el **1 de octubre
de 2007** y rellena todos los elementos con el atributo `data-anios`. El número
que viene en el HTML es solo el valor de respaldo si no hay JavaScript.

## Paleta

| Uso | Color |
|---|---|
| Violeta claro | `#cd9cff` |
| Violeta | `#b469ff` |
| Violeta fuerte | `#9a36ff` |
| Azul claro | `#53aaf1` |
| Azul | `#2493ed` |
| Azul fuerte | `#1179cd` |
| Azul noche | `#0c193e` |
| Fondo | `#040814` |

### Regla de los fondos oscuros

**Todas las bandas de marca van en `#040814`**, no en `#0c193e`: la barra
superior, la franja de posicionamiento, el bloque del logotipo, la cita, la
banda de Misión / Visión / Propósito, las bandas de fichas y el pie. En el CSS
es la variable `--negro-azul`, y valen igual en modo claro y en modo oscuro.

`#0c193e` (`--noche`) se reserva para dos cosas: el botón oscuro de "Contacto"
en modo claro y el fondo de la tarjeta del formulario en modo oscuro.

En modo oscuro el fondo de la página también es `#040814`, así que las bandas se
marcan con un filete tenue en lugar de con un cambio de color.

Las fichas —las de servicio y las de tecnologías— no llevan relleno propio: se
ven sobre la banda, con un filete de `#404553` (`--linea-ficha`), igual que las
reglas horizontales que abren y cierran la fila.

En la cifra de años de experiencia el signo **+** va en `#b469ff` y el número en
`#040814` (o en el color de texto claro cuando el visitante está en modo oscuro,
porque sobre fondo negro el `#040814` sería invisible).

## Una sola cabecera para todo el sitio

**La cabecera, la barra de navegación y el pie están escritos una sola vez**, en
`herramientas/generar-paginas.py`, y desde ahí se escriben en todos los
archivos —incluida la portada, a la que el script le reemplaza esos dos bloques
sin tocar el resto—. Después de editar cualquier cosa de la cabecera:

```
python3 herramientas/generar-paginas.py
```

**Al agregar una página nueva se agrega a ese script**, no se copia y pega el
HTML de otra página. Es la única forma de que las cabeceras no se separen entre
sí con el tiempo.

## Páginas de servicio

Las cuatro páginas de servicio conservan **las mismas URLs que tenían en Google
Sites**, para no perder enlaces ni posicionamiento:

| Servicio | Español | Inglés |
|---|---|---|
| Índice | `/servicios` | `/en/services` |
| ABAP | `/servicios/abap` | `/en/services/abap` |
| Fiori | `/servicios/fiori` | `/en/services/fiori` |
| SAPUI5 | `/servicios/sapui5` | `/en/services/sapui5` |
| Cloud | `/servicios/cloud` | `/en/services/cloud` |
| SAP BTP | `/servicios/btp` | `/en/services/btp` |
| Integration Suite / CPI | `/servicios/integration-suite` | `/en/services/integration-suite` |

En disco cada página es un archivo suelto (`servicios/abap.html`); la URL limpia
sin extensión se mantiene con los `rewrite` de `staticwebapp.config.json`.

Se generan con `herramientas/generar-servicios.py`: el contenido de cada una
(título, lista de servicios, icono) está en ese archivo, en los dos idiomas.
Para cambiar un texto se edita ahí y se vuelve a ejecutar el script, así las
ocho páginas no se desincronizan entre sí.

Las listas de más de ocho puntos se reparten en dos columnas
(`.lista-servicios--larga`), para que la página no se estire de más.

> El sitio de Google Sites traía el encabezado "Servicios de Fábrica de Software
> **Fiori**" también en las páginas de SAPUI5 y de Cloud, por lo que parece un
> copiar-pegar. Aquí quedó con el nombre que corresponde a cada una.

Las páginas antiguas de primer nivel (`/inicio`, `/servicios`, `/nosotros`,
`/contacto`) redirigen con 301 a la sección equivalente de la portada; está
configurado en `staticwebapp.config.json`.

## Páginas de primer nivel

La portada quedó como una presentación corta: franja, logotipo, llamado a la
acción, la fórmula de la metodología, Misión / Visión / Propósito, los años de
experiencia y las tecnologías. Cada sección larga vive en su propia página, con
las mismas URLs que tenía el sitio de Google Sites:

| Página | Español | Inglés |
|---|---|---|
| Servicios | `/servicios` | `/en/services` |
| Nosotros | `/nosotros` | `/en/about` |
| Contacto | `/contacto` | `/en/contact` |

El formulario de contacto ya no está en la portada: vive en `contacto.html`. El
JavaScript que lo maneja está en `main.js` y solo se activa si la página trae el
formulario, así que no hubo que separarlo.

`/inicio` sigue redirigiendo a la portada con 301.

## Página 404

`404.html` se sirve en cualquier URL que no exista, **con código 404 real** (lo
configura `responseOverrides` en `staticwebapp.config.json`). No hay
`navigationFallback`: este sitio no es una SPA, así que una ruta inventada debe
responder 404 y no la portada con código 200, que Google marca como *soft 404*.

Sus rutas a CSS e imágenes son absolutas (`/assets/…`) a propósito, porque se
sirve desde cualquier dirección equivocada. Es el único archivo del sitio que no
se puede revisar con doble clic desde el disco.

## Página de contacto

La sección va sobre el azul de marca `#040814` en los dos temas. La tarjeta del
formulario conserva su fondo propio —blanco en modo claro, `#0c193e` en modo
oscuro—, así que dentro de ella los colores del texto vuelven a los del tema:
son las reglas `.banda-oscura .formulario` al final de la hoja de estilo.

## Formulario de contacto

`POST /api/contacto` recibe el formulario y envía un correo por Microsoft Graph
desde el buzón de CLARILIUM. No guarda datos en ningún lado.

Variables a configurar en el portal de Azure (Static Web App → Configuración):

| Variable | Valor |
|---|---|
| `TENANT_ID` | ID del tenant de Microsoft Entra |
| `CLIENT_ID` | ID de la aplicación registrada |
| `CLIENT_SECRET` | Secreto de la aplicación |
| `MAIL_FROM` | Buzón desde el que se envía |
| `MAIL_TO` | Destinatario (o varios separados por coma) |

> **Ninguna dirección de correo aparece en el sitio ni en el repositorio.**
> `MAIL_FROM` y `MAIL_TO` son secretos: se configuran únicamente en el portal de
> Azure y nunca se escriben en el código, ni siquiera como ejemplo.

El registro de aplicación necesita el permiso de aplicación **`Mail.Send`** de
Microsoft Graph, restringido al buzón emisor con una *application access policy*
de Exchange Online para que no pueda enviar como ningún otro usuario.

Protección contra spam:

- **Campo trampa oculto.** El navegador lo envía siempre y es el servidor quien
  decide: si viene lleno, responde 200 sin enviar nada.
- **Límite de envíos.** 3 por IP cada 10 minutos y 30 en total cada 10 minutos.
  Al pasarse, la función responde 429 y el formulario muestra un aviso propio.
  El contador vive en la memoria de la instancia, así que corta ráfagas pero no
  un ataque distribuido y paciente; si algún día hace falta más, toca un captcha.

## Seguridad y caché

Todo esto vive en `staticwebapp.config.json` y lo aplica Azure en cada respuesta.

### Política de contenido (CSP)

`script-src` **no** permite `'unsafe-inline'`. Cada página lleva un único bloque
de script incrustado —el que aplica tema e idioma antes de pintar, para que no
haya parpadeo— y la CSP lo autoriza por su hash SHA-256.

Ese bloque es **idéntico en las 21 páginas**: los datos que cambian de una a otra
(el idioma y la URL de la otra versión) viajan en atributos del `<html>`:

```html
<html lang="es-MX" data-idioma="es" data-otro="en/index.html">
```

El hash **lo calcula y lo escribe el generador**. No se toca a mano: al correr
`herramientas/generar-paginas.py` se regeneran las páginas y se actualiza la CSP
en el mismo paso, así no pueden quedar desalineadas.

Los bloques `application/ld+json` de datos estructurados no necesitan hash: el
navegador no los ejecuta y la CSP no los bloquea. Está comprobado.

`style-src` tampoco permite `'unsafe-inline'`. No queda ni un atributo `style=`
ni un bloque `<style>` en el HTML — las reglas de la página 404 se mudaron a
`styles.css`. Si algún día agregas un estilo incrustado, dejará de verse: el
lugar correcto es la hoja de estilos.

### Caché

| Ruta | Política | Por qué |
|---|---|---|
| `/assets/img/*` | `max-age=31536000, immutable` | Las imágenes no cambian de contenido |
| `/assets/css/*` | `max-age=0, must-revalidate` | El CSS sí cambia entre versiones |
| `/assets/js/*` | `max-age=0, must-revalidate` | El JS sí cambia entre versiones |

La distinción importa: con `immutable` sobre el CSS, quien ya visitó el sitio
podría seguir viendo el diseño viejo durante un año, y no habría forma de
forzarlo desde el servidor. Con `must-revalidate` el navegador pregunta en cada
carga y recibe un 304 de cero bytes si nada cambió — cuesta prácticamente nada y
garantiza que una actualización se vea de inmediato.

### HSTS

`max-age=31536000; includeSubDomains` — un año, sin `preload`.

Es un compromiso real: **cualquier subdominio de clarilium.com tendrá que servir
HTTPS válido**. Si algún día levantas `intranet.clarilium.com` sin certificado,
los navegadores que ya visitaron el sitio se negarán a abrirlo, y seguirán
negándose hasta que expire el año. No se pone `preload` justamente porque eso sí
sería casi irreversible.

### Formulario de contacto

Defensas, de fuera hacia dentro:

1. **Tipo de contenido** — solo se acepta `application/json`
2. **Filtro de origen** — se aceptan `clarilium.com`, `www.clarilium.com`, los
   entornos de vista previa `*.azurestaticapps.net` y `localhost`. No es una
   frontera de seguridad (la cabecera se puede falsificar), pero descarta a los
   bots que disparan a ciegas
3. **Campo trampa** — invisible para personas; si viene lleno se responde 200 sin
   enviar nada
4. **Validación** — campos obligatorios, longitudes máximas y formato de correo
5. **Limpieza de caracteres de control** — es lo que evita la inyección de
   cabeceras de correo, el truco clásico para convertir un formulario en un relay
   de spam
6. **Escapado de HTML** antes de armar el mensaje
7. **Límite de envíos** — 3 por IP y 30 en total cada diez minutos

El límite vive **en la memoria de la instancia**. Azure recicla y escala
instancias, así que el contador se reinicia de vez en cuando y no es compartido.
Corta ráfagas, que es el 95 % del spam, pero no a un atacante paciente y
distribuido. Si alguna vez hiciera falta, el siguiente escalón es un captcha
(Cloudflare Turnstile es gratuito) — y habría que agregar su dominio a la CSP.

Ningún correo aparece en el código. `MAIL_FROM` y `MAIL_TO` son variables de
entorno en Azure, nunca literales en el repositorio.

## Decisiones tomadas a conciencia

Cosas que **no** son descuidos, sino intercambios elegidos:

**Los enlaces internos usan `.html`, el canonical usa la URL limpia.** Las rutas
de `staticwebapp.config.json` hacen que `/servicios` y `/servicios.html` sirvan lo
mismo. Se enlaza con `.html` porque es lo único que permite revisar el sitio
abriendo `index.html` con doble clic desde el disco, sin levantar un servidor. El
`canonical` y el `sitemap.xml` declaran la URL limpia, que es la que Google indexa.

**Las tipografías se cargan desde Google.** Cada visita manda la IP del visitante
a sus servidores. Alojarlas en `assets/fonts/` lo eliminaría, aceleraría el primer
pintado y permitiría quitar los dos dominios de Google de la CSP. Está pendiente
por decisión, no por olvido.

**La dependencia del API está fijada a una versión exacta** (`4.5.1`, sin `^`) en
lugar de un `package-lock.json`. Con una sola dependencia directa cubre lo
esencial. Para fijar también las transitivas: `cd api && npm install --package-lock-only`
y versionar el archivo resultante.

## El HTML es generado — no se edita a mano

Las 21 páginas las escribe `herramientas/generar-paginas.py`. Si editas un `.html`
directamente, el próximo que corra el generador borra tu cambio.

| Quieres cambiar | Edita |
|---|---|
| Textos de una página de servicio | el diccionario `CONTENIDO` |
| Textos de portada, nosotros o contacto | `INDICE`, `NOSOTROS`, `CONTACTO` |
| Etiquetas comunes (menú, pie, avisos) | `TEXTOS` |
| Cabecera o pie de todas las páginas | `cabecera()` o `pie()` |
| El `<head>` común | `encabezado_html()` |
| El script de tema e idioma | `SCRIPT_TEMA` (y el hash se recalcula solo) |

Después de cualquier cambio:

```bash
python herramientas/generar-paginas.py
```

Las portadas `index.html` y `en/index.html` son las únicas escritas a mano: el
generador solo les sincroniza el `<html>`, el `<head>`, la cabecera y el pie, para
que nunca se separen del resto.

## Marcas de terceros

SAP, ABAP, Fiori, SAPUI5 y SAP BTP son marcas registradas de SAP SE. Se usan
como referencia descriptiva de las tecnologías en las que trabajamos.

> **Pendiente de revisar.** Las imágenes de `assets/img/tec-*.webp` sí reproducen
> marcas gráficas de SAP: el wordmark dentro de su trapecio, la hoja de Fiori y
> el fénix de SAPUI5. SAP restringe el uso de sus logotipos a socios dentro de su
> programa de partners. Si CLARILIUM no está en ese programa, lo seguro es
> sustituirlos por fichas de texto con el nombre de cada tecnología.

## Ver el sitio

Las rutas a CSS, JavaScript e imágenes son **relativas**, así que el sitio se ve
igual de las dos formas:

- **Doble clic en `index.html`** — se abre en el navegador desde el disco, sin
  necesidad de servidor. Es la forma rápida de revisar un cambio.
- **Servido desde Azure** — el caso real de producción.

Lo único que no funciona abriendo el archivo directamente es el envío del
formulario, porque `/api/contacto` solo existe cuando el sitio está publicado.

Para probar también la función hace falta la Azure Static Web Apps CLI
(`npm i -g @azure/static-web-apps-cli` y `swa start . --api-location api`).
