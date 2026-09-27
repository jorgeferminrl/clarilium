const { app } = require('@azure/functions');

/**
 * GET /api/noticias
 * Lee los canales RSS de SAP del lado del servidor y devuelve JSON limpio al
 * portal interno (www.clarilium.com/portal).
 *
 * Por que aqui y no en el navegador: la politica de contenido del sitio solo
 * deja al navegador conectarse al propio sitio y a Microsoft, y los canales
 * de SAP no permiten lectura directa desde otros dominios (CORS).
 *
 * Solo lectura de contenido publico: no usa secretos ni variables de entorno.
 * Defensas: tiempo limite por fuente, tamano maximo de respuesta, se quita
 * todo el HTML (el portal pinta solo texto) y solo pasan enlaces http/https.
 *
 * Cache en memoria de 10 minutos: evita pedir a SAP en cada visita. Si una
 * fuente falla, se sirve lo ultimo bueno que se tenga de ella.
 */

const FUENTES = [
  { id: 'sapnews', url: 'https://news.sap.com/feed/' },
  { id: 'community', url: 'https://community.sap.com/khhcw49343/rss/Community?interaction.style=blog' }
];

const VIGENCIA_MS   = 10 * 60 * 1000;
const TIEMPO_MAX_MS = 8000;
const MAX_BYTES     = 6 * 1024 * 1024;
const MAX_ITEMS     = 12;
const MAX_RESUMEN   = 280;

let cache = null;                 // { t, cuerpo }
const ultimoBueno = new Map();    // id -> items

/* ---------- Limpieza de texto ---------- */
const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };

function decodificar(texto) {
  return String(texto || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (todo, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : '';
    }
    return ENTIDADES[e.toLowerCase()] ?? todo;
  });
}

function sinCdata(texto) {
  return String(texto || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** Texto plano: sin CDATA, sin etiquetas, sin entidades, espacios colapsados. */
function textoPlano(crudo) {
  let t = decodificar(sinCdata(crudo));          // el HTML puede venir escapado
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ');
  t = decodificar(t);
  return t.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
}

function recortar(t, max) {
  if (t.length <= max) return t;
  const corte = t.slice(0, max);
  return corte.slice(0, Math.max(corte.lastIndexOf(' '), max - 30)).trim() + '…';
}

function enlaceSeguro(url) {
  try {
    const u = new URL(decodificar(sinCdata(url)).trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}

/* ---------- Lectura de RSS 2.0 (y Atom por si cambian el formato) ---------- */
function etiqueta(bloque, nombre) {
  const m = bloque.match(new RegExp(`<${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</${nombre}>`, 'i'));
  return m ? m[1] : '';
}

function leerCanal(xml) {
  const bloques = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = [];
  for (const b of bloques) {
    const titulo = recortar(textoPlano(etiqueta(b, 'title')), 200);
    const enlace = enlaceSeguro(etiqueta(b, 'link') || (b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || etiqueta(b, 'guid'));
    if (!titulo || !enlace) continue;
    const fechaTxt = textoPlano(etiqueta(b, 'pubDate') || etiqueta(b, 'updated') || etiqueta(b, 'published') || etiqueta(b, 'dc:date'));
    const fecha = Date.parse(fechaTxt);
    const autor = recortar(textoPlano(etiqueta(b, 'dc:creator') || etiqueta(etiqueta(b, 'author'), 'name') || etiqueta(b, 'author')), 80);
    const resumen = recortar(textoPlano(etiqueta(b, 'description') || etiqueta(b, 'summary') || etiqueta(b, 'content:encoded')), MAX_RESUMEN);
    items.push({ titulo, enlace, fecha: Number.isFinite(fecha) ? new Date(fecha).toISOString() : null, autor, resumen });
  }
  items.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  return items.slice(0, MAX_ITEMS);
}

async function leerFuente(fuente, context) {
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIEMPO_MAX_MS);
  try {
    const r = await fetch(fuente.url, {
      signal: control.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; CLARILIUM-Portal/1.0; +https://www.clarilium.com)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8'
      }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const largo = Number(r.headers.get('content-length') || 0);
    if (largo > MAX_BYTES) throw new Error('respuesta demasiado grande');
    const xml = (await r.text()).slice(0, MAX_BYTES);
    const items = leerCanal(xml);
    if (!items.length) throw new Error('el canal no trajo publicaciones');
    ultimoBueno.set(fuente.id, items);
    return { id: fuente.id, ok: true, items };
  } catch (error) {
    context.warn(`noticias: fallo ${fuente.id}: ${error.message}`);
    const previo = ultimoBueno.get(fuente.id);
    return previo ? { id: fuente.id, ok: true, desactualizado: true, items: previo } : { id: fuente.id, ok: false, items: [] };
  } finally {
    clearTimeout(reloj);
  }
}

app.http('noticias', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'noticias',
  handler: async (request, context) => {
    const ahora = Date.now();
    if (!cache || ahora - cache.t > VIGENCIA_MS) {
      const fuentes = await Promise.all(FUENTES.map(f => leerFuente(f, context)));
      const cuerpo = JSON.stringify({ generado: new Date(ahora).toISOString(), fuentes });
      // Solo se guarda en cache si todas respondieron; si no, se reintenta en la siguiente visita.
      cache = fuentes.every(f => f.ok && !f.desactualizado) ? { t: ahora, cuerpo } : null;
      return respuesta(cuerpo);
    }
    return respuesta(cache.cuerpo);
  }
});

function respuesta(cuerpo) {
  return {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    },
    body: cuerpo
  };
}
