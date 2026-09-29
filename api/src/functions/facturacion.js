const crypto = require('crypto');
const { app } = require('@azure/functions');
const { analizarXml, analizarPdf, cruzar, ErrorFactura } = require('../../lib/cfdi');

/**
 * POST /api/facturacion
 * Recibe la factura de un colaborador desde www.clarilium.com/portal/facturacion
 * y la envia por correo, con el XML y el PDF adjuntos, a los destinatarios de
 * la lista de SharePoint DestinatariosFacturacionColaboradores. No guarda nada.
 *
 * Privacidad: las direcciones de los destinatarios y el buzon que envia solo
 * existen aqui, en el servidor. Nunca viajan al navegador (ni en respuestas ni
 * en errores) y el colaborador no recibe copia, para que ninguna cabecera del
 * correo las revele.
 *
 * Quien puede enviar: solo una cuenta @clarilium.com con sesion iniciada en el
 * portal. La pagina manda su ID token de Microsoft Entra y aqui se verifica la
 * firma con las llaves publicas de Microsoft, el tenant, la audiencia (el
 * registro "CLARILIUM Reportes") y la vigencia.
 *
 * Variables de entorno (Azure Portal -> Static Web App -> Variables de entorno):
 *   TENANT_ID, CLIENT_ID, CLIENT_SECRET   Las mismas del formulario de contacto
 *   MAIL_FROM                             Buzon que envia (contacto@)
 *   FACTURACION_LISTA (opcional)          Nombre de la lista; por omision
 *                                         DestinatariosFacturacionColaboradores
 *   PORTAL_CLIENT_ID (opcional)           Id. de "CLARILIUM Reportes"
 *   PORTAL_TENANT_ID (opcional)           GUID del tenant (por omision el de CLARILIUM)
 *
 * Permisos que necesita el registro de CLIENT_ID en Entra ID:
 *   Mail.Send (ya lo tiene, limitado a contacto@) y Sites.Selected con permiso
 *   de lectura SOLO sobre el sitio de SharePoint "timesheet".
 */

const CONFIG = {
  tenant: () => process.env.TENANT_ID,
  // Id. (GUID) del tenant, el que viene en el token. TENANT_ID puede estar
  // escrito como dominio (clarilium.onmicrosoft.com) y no serviria para comparar.
  tenantId: () => process.env.PORTAL_TENANT_ID || '4ded6d76-6c1b-43eb-813b-423ecf957f15',
  portalClientId: () => process.env.PORTAL_CLIENT_ID || 'e122c4bd-0f08-48c1-a274-f55925229261',
  lista: () => process.env.FACTURACION_LISTA || 'DestinatariosFacturacionColaboradores',
  sharepointHost: 'clarilium.sharepoint.com',
  sitio: '/sites/timesheet',
  dominio: '@clarilium.com',
  maxCuerpo: 3_700_000,                    // bytes del JSON recibido
  maxXml: 1024 * 1024,
  maxPdf: 2 * 1024 * 1024,
  maxTotal: Math.floor(2.5 * 1024 * 1024), // Graph admite ~3 MB de adjuntos en un solo envio
  maxDestinatarios: 25
};

const LIMITES = { nombre: 60, apellido: 60, tipoServicio: 120, contacto: 120 };
const m = (es, en) => ({ es, en });
const norm = (v) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/* ---------- Limite de envios (en memoria, por cuenta y global) ---------- */
const VENTANA_MS = 10 * 60 * 1000;
const MAX_POR_CUENTA = 5;
const MAX_GLOBAL = 40;
const envios = new Map();
let enviosGlobales = [];

function excedeLimite(cuenta) {
  const ahora = Date.now();
  const vigentes = (l) => l.filter((t) => ahora - t < VENTANA_MS);
  enviosGlobales = vigentes(enviosGlobales);
  if (enviosGlobales.length >= MAX_GLOBAL) return true;
  const propios = vigentes(envios.get(cuenta) || []);
  if (propios.length >= MAX_POR_CUENTA) { envios.set(cuenta, propios); return true; }
  propios.push(ahora);
  envios.set(cuenta, propios);
  enviosGlobales.push(ahora);
  if (envios.size > 200) for (const [k, v] of envios) if (!vigentes(v).length) envios.delete(k);
  return false;
}

/* ---------- Verificacion del ID token de Microsoft Entra ---------- */
let llaves = { porKid: new Map(), leidas: 0 };

async function llavePublica(kid) {
  const vieja = Date.now() - llaves.leidas;
  if (!llaves.porKid.has(kid) && vieja > 5 * 60 * 1000 || vieja > 12 * 3600 * 1000) {
    const r = await fetch(`https://login.microsoftonline.com/${CONFIG.tenantId()}/discovery/v2.0/keys`);
    if (!r.ok) throw new Error(`JWKS: HTTP ${r.status}`);
    const { keys } = await r.json();
    const porKid = new Map();
    for (const k of keys || []) if (k.kty === 'RSA' && k.kid) porKid.set(k.kid, crypto.createPublicKey({ key: { kty: k.kty, n: k.n, e: k.e }, format: 'jwk' }));
    llaves = { porKid, leidas: Date.now() };
  }
  return llaves.porKid.get(kid) || null;
}

const deBase64Url = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

/** Devuelve { correo, nombre, oid } si el token es valido; si no, null. */
async function verificarToken(request) {
  // Va en una cabecera propia: Azure Static Web Apps reserva "Authorization"
  // para su inicio de sesion integrado y no siempre la entrega a la funcion.
  const token = (request.headers.get('x-clarilium-token') || '').trim();
  const partes = token.split('.');
  if (partes.length !== 3 || token.length > 8000) return null;
  let enc, datos;
  try {
    enc = JSON.parse(deBase64Url(partes[0]).toString('utf8'));
    datos = JSON.parse(deBase64Url(partes[1]).toString('utf8'));
  } catch { return null; }
  if (enc.alg !== 'RS256' || !enc.kid) return null;

  const llave = await llavePublica(enc.kid);
  if (!llave) return null;
  const firmaValida = crypto.verify('RSA-SHA256', Buffer.from(`${partes[0]}.${partes[1]}`), llave, deBase64Url(partes[2]));
  if (!firmaValida) return null;

  const ahora = Math.floor(Date.now() / 1000);
  const tenant = CONFIG.tenantId();
  const correo = norm(datos.preferred_username || '');
  if (datos.aud !== CONFIG.portalClientId()) return null;
  if (datos.tid !== tenant || datos.iss !== `https://login.microsoftonline.com/${tenant}/v2.0`) return null;
  if (typeof datos.exp !== 'number' || datos.exp < ahora - 60) return null;
  if (typeof datos.nbf === 'number' && datos.nbf > ahora + 60) return null;
  if (!correo.endsWith(CONFIG.dominio) || correo.includes('#ext#')) return null;
  return { correo, nombre: String(datos.name || correo).slice(0, 120), oid: String(datos.oid || correo) };
}

/* ---------- Microsoft Graph con permiso de aplicacion ---------- */
let tokenApp = { valor: null, vence: 0 };

async function obtenerToken() {
  if (tokenApp.valor && Date.now() < tokenApp.vence) return tokenApp.valor;
  const r = await fetch(`https://login.microsoftonline.com/${CONFIG.tenant()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials'
    })
  });
  if (!r.ok) throw new Error(`Token: HTTP ${r.status} ${await r.text()}`);
  const j = await r.json();
  tokenApp = { valor: j.access_token, vence: Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000 };
  return tokenApp.valor;
}

async function graph(token, ruta) {
  const r = await fetch(ruta.startsWith('https://') ? ruta : `https://graph.microsoft.com/v1.0${ruta}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  });
  if (!r.ok) {
    const e = new Error(`Graph ${ruta}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function graphTodo(token, ruta) {
  const items = [];
  for (let sig = ruta; sig;) {
    const pagina = await graph(token, sig);
    items.push(...(pagina.value || []));
    sig = pagina['@odata.nextLink'] || null;
  }
  return items;
}

/* ---------- Destinatarios desde SharePoint ----------
   Toma los correos de cualquier columna de texto de la lista y los de las
   columnas de tipo Persona. Si la lista tiene una columna Si/No llamada
   "Activo", las filas marcadas como No se omiten. */
const RE_CORREO = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const CAMPOS_SISTEMA = new Set(['Author', 'Editor', 'AuthorLookupId', 'EditorLookupId', 'id', 'ContentType', 'Attachments', 'Edit', 'DocIcon', 'ItemChildCount', 'FolderChildCount', 'AppAuthorLookupId', 'AppEditorLookupId']);

async function leerDestinatarios(token) {
  const sitio = await graph(token, `/sites/${CONFIG.sharepointHost}:${CONFIG.sitio}?$select=id`);
  const listas = await graphTodo(token, `/sites/${sitio.id}/lists?$select=id,name,displayName,system`);
  const buscada = norm(CONFIG.lista());
  const lista = listas.find((l) => norm(l.displayName) === buscada || norm(l.name) === buscada);
  if (!lista) throw new Error(`No existe la lista ${CONFIG.lista()} en el sitio timesheet.`);

  const base = `/sites/${sitio.id}/lists/${lista.id}`;
  const columnas = await graphTodo(token, `${base}/columns?$select=name,displayName,personOrGroup,boolean,readOnly`);
  const personas = columnas.filter((c) => c.personOrGroup && !c.readOnly && !CAMPOS_SISTEMA.has(c.name)).map((c) => c.name);
  const activo = columnas.find((c) => c.boolean && ['activo', 'activa', 'active', 'habilitado'].includes(norm(c.displayName)));
  const items = await graphTodo(token, `${base}/items?$expand=fields&$top=200`);

  const correos = new Set();
  const idsPersona = new Set();
  for (const item of items) {
    const f = item.fields || {};
    if (activo && f[activo.name] === false) continue;
    for (const [clave, valor] of Object.entries(f)) {
      if (clave.startsWith('@') || clave.startsWith('_') || CAMPOS_SISTEMA.has(clave)) continue;
      if (clave.endsWith('LookupId') && personas.includes(clave.slice(0, -8))) {
        [].concat(valor).forEach((v) => { if (/^\d+$/.test(String(v))) idsPersona.add(String(v)); });
        continue;
      }
      const texto = typeof valor === 'string' ? valor : JSON.stringify(valor);
      (texto.match(RE_CORREO) || []).forEach((c) => correos.add(c.toLowerCase()));
    }
  }

  // Columnas Persona: el correo vive en la lista oculta "User Information List".
  if (idsPersona.size) {
    const uil = listas.find((l) => l.name === 'users' || norm(l.displayName) === 'user information list');
    if (uil) {
      for (const id of idsPersona) {
        try {
          const u = await graph(token, `/sites/${sitio.id}/lists/${uil.id}/items/${id}?$expand=fields($select=EMail)`);
          const c = u.fields && u.fields.EMail;
          if (c && c.match(RE_CORREO)) correos.add(c.toLowerCase());
        } catch { /* usuario borrado: se ignora */ }
      }
    }
  }
  return [...correos].slice(0, CONFIG.maxDestinatarios);
}

/* ---------- Validacion de lo recibido ---------- */
function limpiar(valor, max) {
  if (typeof valor !== 'string') return '';
  return valor.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function nombreArchivo(valor, ext) {
  let n = limpiar(valor, 120).split(/[\\/]/).pop() || '';
  n = n.replace(/[^\p{L}\p{N} ._()-]/gu, '_').replace(/^\.+/, '');
  if (!n.toLowerCase().endsWith(`.${ext}`)) n = `${n || 'factura'}.${ext}`;
  return n.length > 100 ? `${n.slice(0, 95 - ext.length)}.${ext}` : n;
}

function decodificar(archivo, ext, max) {
  if (!archivo || typeof archivo !== 'object') return null;
  const b64 = typeof archivo.contenido === 'string' ? archivo.contenido : '';
  if (!b64 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return null;
  const bytes = Buffer.from(b64, 'base64');
  if (!bytes.length || bytes.length > max) return null;
  if (typeof archivo.nombre !== 'string' || !norm(archivo.nombre).endsWith(`.${ext}`)) return null;
  return { bytes, nombre: nombreArchivo(archivo.nombre, ext) };
}

function origenPermitido(request) {
  const origen = request.headers.get('origin');
  if (!origen) return true;
  try {
    const { hostname, protocol } = new URL(origen);
    if (protocol !== 'https:') return false;
    return hostname === 'www.clarilium.com' || hostname === 'clarilium.com' || hostname.endsWith('.azurestaticapps.net');
  } catch { return false; }
}

const rechazo = (status, errores) => ({ status, jsonBody: { ok: false, errores } });

/* ---------- Correo ---------- */
async function enviarCorreo(token, destinatarios, datos, xml, pdf, usuario) {
  const nombreApellido = `${datos.nombre} ${datos.apellido}`;
  const cuerpo = `${nombreApellido} ha subido la factura electrónica por el servicio de ${datos.tipoServicio} solicitado por ${datos.contacto}.`;
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MAIL_FROM)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: `Factura electrónica · ${nombreApellido} · ${datos.tipoServicio}`,
        // Texto plano: lo capturado nunca se interpreta como HTML.
        body: { contentType: 'Text', content: cuerpo },
        toRecipients: destinatarios.map((address) => ({ emailAddress: { address } })),
        replyTo: [{ emailAddress: { address: usuario.correo, name: usuario.nombre } }],
        attachments: [
          { '@odata.type': '#microsoft.graph.fileAttachment', name: xml.nombre, contentType: 'application/xml', contentBytes: xml.bytes.toString('base64') },
          { '@odata.type': '#microsoft.graph.fileAttachment', name: pdf.nombre, contentType: 'application/pdf', contentBytes: pdf.bytes.toString('base64') }
        ]
      },
      saveToSentItems: true
    })
  });
  if (!r.ok) throw new Error(`sendMail: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
}

app.http('facturacion', {
  methods: ['POST'],
  authLevel: 'anonymous', // la autorizacion real es el ID token que se verifica abajo
  route: 'facturacion',
  handler: async (request, context) => {
    if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json'))
      return { status: 415, jsonBody: { ok: false } };
    if (!origenPermitido(request)) return { status: 403, jsonBody: { ok: false } };

    let usuario;
    try { usuario = await verificarToken(request); }
    catch (e) { context.error('Facturacion: no se pudieron leer las llaves de Entra ID:', e.message); return { status: 503, jsonBody: { ok: false } }; }
    if (!usuario) return { status: 401, jsonBody: { ok: false } };

    const largo = Number(request.headers.get('content-length') || 0);
    if (largo > CONFIG.maxCuerpo) return rechazo(413, [m('Los archivos son demasiado grandes.', 'The files are too large.')]);
    let cuerpo;
    try {
      const texto = await request.text();
      if (texto.length > CONFIG.maxCuerpo) return rechazo(413, [m('Los archivos son demasiado grandes.', 'The files are too large.')]);
      cuerpo = JSON.parse(texto);
    } catch { return rechazo(400, [m('Solicitud inválida.', 'Invalid request.')]); }
    if (!cuerpo || typeof cuerpo !== 'object') return rechazo(400, [m('Solicitud inválida.', 'Invalid request.')]);

    const datos = {
      nombre: limpiar(cuerpo.nombre, LIMITES.nombre),
      apellido: limpiar(cuerpo.apellido, LIMITES.apellido),
      tipoServicio: limpiar(cuerpo.tipoServicio, LIMITES.tipoServicio),
      contacto: limpiar(cuerpo.contacto, LIMITES.contacto)
    };
    const errores = [];
    if (!datos.nombre) errores.push(m('Falta capturar «Nombre».', '“First name” is required.'));
    if (!datos.apellido) errores.push(m('Falta capturar «Apellido».', '“Last name” is required.'));
    if (!datos.tipoServicio) errores.push(m('Falta capturar «Tipo de servicio».', '“Type of service” is required.'));
    if (!datos.contacto) errores.push(m('Falta capturar «Contacto que solicitó el servicio».', '“Contact who requested the service” is required.'));
    const xml = decodificar(cuerpo.xml, 'xml', CONFIG.maxXml);
    const pdf = decodificar(cuerpo.pdf, 'pdf', CONFIG.maxPdf);
    if (!xml) errores.push(m('El archivo XML falta, no es .xml o pesa más de 1 MB.', 'The XML file is missing, is not .xml or is larger than 1 MB.'));
    if (!pdf) errores.push(m('El archivo PDF falta, no es .pdf o pesa más de 2 MB.', 'The PDF file is missing, is not .pdf or is larger than 2 MB.'));
    if (xml && pdf && xml.bytes.length + pdf.bytes.length > CONFIG.maxTotal) errores.push(m('Entre los dos archivos pesan más de 2.5 MB.', 'Together the two files exceed 2.5 MB.'));
    if (errores.length) return rechazo(400, errores);

    // Misma revision que hace la pagina: formato de cada archivo y cruce XML <-> PDF.
    let cfdi, textoPdf;
    try { cfdi = analizarXml(xml.bytes); }
    catch (e) {
      if (e instanceof ErrorFactura) return rechazo(400, [m(`XML: ${e.msg.es}`, `XML: ${e.msg.en}`)]);
      context.error('Facturacion: error leyendo el XML:', e.message);
      return rechazo(400, [m('XML: no se pudo leer.', 'XML: it could not be read.')]);
    }
    try { textoPdf = await analizarPdf(pdf.bytes); }
    catch (e) {
      if (e instanceof ErrorFactura) return rechazo(400, [m(`PDF: ${e.msg.es}`, `PDF: ${e.msg.en}`)]);
      context.error('Facturacion: error leyendo el PDF:', e.message);
      return { status: 500, jsonBody: { ok: false } };
    }
    const diferencias = cruzar(cfdi, textoPdf);
    if (diferencias.length) return rechazo(400, diferencias);

    if (excedeLimite(usuario.oid)) {
      context.warn('Facturacion: limite de envios alcanzado.');
      return { status: 429, jsonBody: { ok: false } };
    }

    try {
      const token = await obtenerToken();
      const destinatarios = await leerDestinatarios(token);
      if (!destinatarios.length) throw new Error('La lista de destinatarios no tiene ningun correo.');
      await enviarCorreo(token, destinatarios, datos, xml, pdf, usuario);
      // En el log queda el UUID y la cuenta, nunca los destinatarios.
      context.log(`Facturacion: factura ${cfdi.uuid} enviada por ${usuario.correo} a ${destinatarios.length} destinatario(s).`);
      return { status: 200, jsonBody: { ok: true } };
    } catch (e) {
      // El detalle solo va al log de Azure, nunca al navegador.
      context.error('Facturacion: no se pudo enviar:', e.message);
      return { status: 502, jsonBody: { ok: false } };
    }
  }
});
