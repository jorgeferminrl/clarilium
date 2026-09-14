const { app } = require('@azure/functions');

/**
 * POST /api/contacto
 * Recibe el formulario del sitio y envía el mensaje por correo usando
 * Microsoft Graph con el tenant de CLARILIUM. No guarda nada.
 *
 * Variables de entorno (Azure Portal → Static Web App → Configuración):
 *   TENANT_ID      ID del tenant de Microsoft Entra
 *   CLIENT_ID      ID de la aplicación registrada
 *   CLIENT_SECRET  Secreto de la aplicación
 *   MAIL_FROM      Buzón desde el que se envía (secreto: solo en Azure)
 *   MAIL_TO        Destinatario, o varios separados por coma (secreto: solo en Azure)
 *
 * Defensas: tipo de contenido, filtro de origen, campo trampa, validación de
 * longitudes, limpieza de caracteres de control (evita inyección de cabeceras
 * de correo) y escapado del HTML antes de armar el mensaje.
 *
 * Límite de envíos: 3 por IP cada 10 minutos y 30 en total cada 10 minutos.
 * Es un límite en memoria: protege de ráfagas, no de un ataque distribuido y
 * paciente. Si alguna vez hace falta más, toca poner un captcha o subir de tier.
 */

const LIMITES = { nombre: 80, empresa: 80, correo: 120, telefono: 30, mensaje: 2000 };

/* ---------- Límite de envíos ----------
   El contador vive en la memoria de la instancia. Azure recicla instancias, así
   que el límite se reinicia de vez en cuando; aun así corta las ráfagas, que es
   de lo que hay que proteger al buzón. */
const VENTANA_MS   = 10 * 60 * 1000;
const MAX_POR_IP   = 3;
const MAX_GLOBAL   = 30;

const envios = new Map(); // ip -> [marcas de tiempo]
let enviosGlobales = [];

function recientes(lista, ahora) {
  return lista.filter((t) => ahora - t < VENTANA_MS);
}

/** Devuelve true si hay que rechazar por exceso de envíos. */
function excedeLimite(ip) {
  const ahora = Date.now();

  enviosGlobales = recientes(enviosGlobales, ahora);
  if (enviosGlobales.length >= MAX_GLOBAL) return true;

  const propios = recientes(envios.get(ip) || [], ahora);
  if (propios.length >= MAX_POR_IP) {
    envios.set(ip, propios);
    return true;
  }

  propios.push(ahora);
  envios.set(ip, propios);
  enviosGlobales.push(ahora);

  // Limpieza: evitamos que el Map crezca sin fin si la instancia vive mucho.
  if (envios.size > 500) {
    for (const [clave, marcas] of envios) {
      if (recientes(marcas, ahora).length === 0) envios.delete(clave);
    }
  }
  return false;
}

/** IP del visitante según la cabecera que pone Azure Static Web Apps. */
function ipDe(request) {
  const cabecera =
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-azure-clientip') ||
    '';
  // x-forwarded-for puede venir como "ip:puerto, proxy1, proxy2"
  return cabecera.split(',')[0].trim().replace(/:\d+$/, '') || 'desconocida';
}

function limpiar(valor, max) {
  if (typeof valor !== 'string') return '';
  return valor.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, max);
}

function escapar(texto) {
  return texto.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function correoValido(correo) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(correo);
}

async function obtenerToken() {
  const url = `https://login.microsoftonline.com/${process.env.TENANT_ID}/oauth2/v2.0/token`;
  const cuerpo = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: cuerpo
  });
  if (!r.ok) throw new Error(`Token: HTTP ${r.status} ${await r.text()}`);
  return (await r.json()).access_token;
}

async function enviarCorreo(token, datos) {
  const asunto = `Contacto web — ${datos.nombre}${datos.empresa ? ' · ' + datos.empresa : ''}`;

  const filas = [
    ['Nombre', datos.nombre],
    ['Empresa', datos.empresa || '—'],
    ['Correo', datos.correo],
    ['Teléfono', datos.telefono || '—'],
    ['Idioma', datos.idioma || '—']
  ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${k}</td><td><strong>${escapar(v)}</strong></td></tr>`).join('');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1a1a1a">
      <p>Nuevo mensaje desde <strong>clarilium.com</strong>:</p>
      <table style="border-collapse:collapse;margin-bottom:16px">${filas}</table>
      <div style="border-left:3px solid #9a36ff;padding-left:14px;white-space:pre-wrap">${escapar(datos.mensaje)}</div>
    </div>`;

  const destinatarios = (process.env.MAIL_TO || process.env.MAIL_FROM)
    .split(',')
    .map((d) => ({ emailAddress: { address: d.trim() } }));

  const r = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(process.env.MAIL_FROM)}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject: asunto,
          body: { contentType: 'HTML', content: html },
          toRecipients: destinatarios,
          replyTo: [{ emailAddress: { address: datos.correo, name: datos.nombre } }]
        },
        saveToSentItems: true
      })
    }
  );
  if (!r.ok) throw new Error(`sendMail: HTTP ${r.status} ${await r.text()}`);
}

/* Orígenes desde los que aceptamos el formulario. No es una frontera de
   seguridad —cualquiera puede falsificar la cabecera— pero descarta a los bots
   que disparan a ciegas sin simular un navegador. Los entornos de vista previa
   de Azure usan subdominios de azurestaticapps.net. */
function origenPermitido(request) {
  const origen = request.headers.get('origin');
  if (!origen) return true; // navegaciones sin Origin y pruebas legítimas
  try {
    const { hostname, protocol } = new URL(origen);
    if (protocol !== 'https:' && hostname !== 'localhost') return false;
    return (
      hostname === 'clarilium.com' ||
      hostname === 'www.clarilium.com' ||
      hostname.endsWith('.azurestaticapps.net') ||
      hostname === 'localhost'
    );
  } catch {
    return false;
  }
}

app.http('contacto', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'contacto',
  handler: async (request, context) => {
    const tipo = request.headers.get('content-type') || '';
    if (!tipo.toLowerCase().startsWith('application/json')) {
      return { status: 415, jsonBody: { error: 'Tipo de contenido no admitido' } };
    }

    if (!origenPermitido(request)) {
      context.warn('Envío de contacto rechazado por origen no reconocido.');
      return { status: 403, jsonBody: { error: 'Origen no permitido' } };
    }

    let cuerpo;
    try {
      cuerpo = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: 'Solicitud inválida' } };
    }

    // Trampa antispam: si viene llena, respondemos 200 sin enviar nada.
    if (limpiar(cuerpo.sitioWeb, 50)) {
      return { status: 200, jsonBody: { ok: true } };
    }

    const datos = {
      nombre:   limpiar(cuerpo.nombre,   LIMITES.nombre),
      empresa:  limpiar(cuerpo.empresa,  LIMITES.empresa),
      correo:   limpiar(cuerpo.correo,   LIMITES.correo),
      telefono: limpiar(cuerpo.telefono, LIMITES.telefono),
      mensaje:  limpiar(cuerpo.mensaje,  LIMITES.mensaje),
      idioma:   limpiar(cuerpo.idioma,   10)
    };

    if (!datos.nombre || !datos.mensaje || !correoValido(datos.correo)) {
      return { status: 400, jsonBody: { error: 'Faltan datos obligatorios o el correo no es válido' } };
    }

    // Se cuenta solo lo que ya pasó validación, para no gastar el cupo
    // de un visitante legítimo en un error de captura suyo.
    if (excedeLimite(ipDe(request))) {
      context.warn('Envío de contacto rechazado por límite de frecuencia.');
      return { status: 429, jsonBody: { error: 'Demasiados envíos. Inténtalo más tarde.' } };
    }

    try {
      const token = await obtenerToken();
      await enviarCorreo(token, datos);
      return { status: 200, jsonBody: { ok: true } };
    } catch (e) {
      // El detalle solo va al log de Azure, nunca al navegador.
      context.error('Error enviando el correo de contacto:', e.message);
      return { status: 502, jsonBody: { error: 'No se pudo enviar el mensaje' } };
    }
  }
});
