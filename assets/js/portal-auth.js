"use strict";

/* ==================================================================== *
 * Acceso comun del portal interno · www.clarilium.com/portal
 * Todas las paginas bajo /portal cargan este archivo. El inicio de sesion
 * regresa siempre a /portal (una sola URI registrada en Entra ID) y de ahi
 * MSAL devuelve al usuario a la pagina exacta donde estaba. La sesion se
 * guarda en el navegador y la comparten todas las paginas del portal.
 * Registro de aplicacion: "CLARILIUM Reportes" (el mismo del TimeSheet).
 * ==================================================================== */

const PORTAL = {
  graph: {
    base: "https://graph.microsoft.com/v1.0",
    clientId: "e122c4bd-0f08-48c1-a274-f55925229261",
    tenantId: "4ded6d76-6c1b-43eb-813b-423ecf957f15",
    scopes: ["User.Read", "Sites.Manage.All"],
    hostname: "clarilium.sharepoint.com",
    sitePath: "/sites/timesheet"
  },
  rutaRegreso: "/portal",
  dominio: "@clarilium.com",
  // Herramientas que muestra la pagina principal del portal.
  // Para agregar una: crear portal/<nombre>.html, anadirla aqui y agregar su
  // ruta /portal/<nombre> en staticwebapp.config.json (la politica de seguridad
  // de /portal/* ya la cubre).
  herramientas: [
    { ruta: "portal/estimacion", nombre: "Estimaciones",
      descripcion: "Genera el PDF de estimación de construcción de un requerimiento." }
  ]
};

const esDemo = () => window.location.protocol === "file:";
const $ = id => document.getElementById(id);
const norm = v => String(v ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

// Enlace interno que funciona publicado (sin .html) y abierto desde el disco (con .html).
function enlacePortal(ruta, prefijo = "") {
  return prefijo + ruta + (esDemo() ? ".html" : "");
}

/* ------------------------------------------------------------------ *
 * Inicio de sesion (MSAL)
 * ------------------------------------------------------------------ */
const auth = {
  client: null, account: null,

  async init() {
    if (!window.msal) throw new Error("No se pudo cargar la biblioteca de inicio de sesión de Microsoft. Revisa tu conexión.");
    this.client = new msal.PublicClientApplication({
      auth: {
        clientId: PORTAL.graph.clientId,
        authority: `https://login.microsoftonline.com/${PORTAL.graph.tenantId}`,
        redirectUri: window.location.origin + PORTAL.rutaRegreso,
        postLogoutRedirectUri: window.location.origin + PORTAL.rutaRegreso,
        // Tras iniciar sesion en /portal, regresa a la pagina que lo pidio.
        navigateToLoginRequestUrl: true
      },
      cache: { cacheLocation: "localStorage" }
    });
    await this.client.initialize();
    const resultado = await this.client.handleRedirectPromise();
    if (resultado?.account) this.client.setActiveAccount(resultado.account);

    let cuenta = this.client.getActiveAccount() || this.client.getAllAccounts()[0] || null;
    if (!cuenta) {
      const conLimite = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error("tiempo agotado")), ms))]);
      try { cuenta = (await conLimite(this.client.ssoSilent({ scopes: PORTAL.graph.scopes }), 5000)).account; }
      catch { cuenta = null; }
    }
    if (cuenta) this.client.setActiveAccount(cuenta);
    this.account = cuenta;
    return Boolean(cuenta);
  },

  // Solo cuentas propias del tenant con dominio @clarilium.com (nada de invitados).
  cuentaPermitida() {
    const u = norm(this.account?.username);
    return u.endsWith(PORTAL.dominio) && !u.includes("#ext#");
  },

  entrar() { return this.client.loginRedirect({ scopes: PORTAL.graph.scopes }); },
  salir() { return this.client.logoutRedirect({ account: this.account }); },

  async token(scopes = PORTAL.graph.scopes, redirigir = true) {
    const peticion = { scopes, account: this.account };
    try {
      return (await this.client.acquireTokenSilent(peticion)).accessToken;
    } catch (error) {
      if (!redirigir) throw error;
      await this.client.acquireTokenRedirect(peticion);
      throw new Error("Renovando la sesión…");
    }
  }
};

/* ------------------------------------------------------------------ *
 * Microsoft Graph
 * ------------------------------------------------------------------ */
async function graphGet(url, token) {
  let r;
  try { r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }); }
  catch { throw new Error("No se pudo contactar a Microsoft Graph. Revisa tu conexión a internet."); }
  if (r.status === 401) throw new Error("La sesión caducó. Vuelve a iniciar sesión.");
  if (r.status === 403) { const e = new Error("Tu cuenta no tiene permiso para esta consulta."); e.status = 403; throw e; }
  if (!r.ok) throw new Error(`Microsoft Graph respondió HTTP ${r.status}.`);
  return r.json();
}

async function graphTodo(url, token) {
  const items = [];
  for (let next = url; next;) {
    const pagina = await graphGet(next, token);
    items.push(...(pagina.value || []));
    next = pagina["@odata.nextLink"] || null;
  }
  return items;
}

/* ------------------------------------------------------------------ *
 * Porton de acceso, comun a todas las paginas del portal
 * ------------------------------------------------------------------ */
let accionReintentar = () => window.location.reload();

function porton({ girando = false, entrar = false, error = "", reintentar = false } = {}) {
  $("porton").classList.remove("porton--oculto");
  $("portonGirando").hidden = !girando;
  $("portonMensaje").hidden = girando;
  $("entrar").hidden = !entrar;
  $("portonError").hidden = !error;
  $("portonError").textContent = error;
  $("reintentar").hidden = !reintentar;
}

function abrirPagina(nombre) {
  $("porton").classList.add("porton--oculto");
  $("principal").hidden = false;
  $("cuentaNombre").textContent = nombre;
  $("cuenta").hidden = false;
}

// Arranque comun. Cada pagina entrega que hacer al entrar y en modo demo.
async function iniciarPortal({ alEntrar, alDemo, nombreDemo = "Usuario Demo" }) {
  // Dentro del marco oculto de la verificacion silenciosa (ssoSilent) no se
  // hace nada: la pagina que lo abrio lee la respuesta de Microsoft del marco.
  if (window.self !== window.top) return;

  $("entrar").addEventListener("click", () => auth.entrar());
  $("reintentar").addEventListener("click", () => accionReintentar());
  $("salir").addEventListener("click", () => auth.salir());

  if (esDemo()) {
    $("demoBanner").hidden = false;
    $("salir").hidden = true;
    abrirPagina(nombreDemo);
    await alDemo?.();
    return;
  }

  porton({ girando: true });
  const vigilante = setTimeout(() => {
    if (!$("portonGirando").hidden) porton({ error: "La conexión con Microsoft está tardando más de lo normal. Revisa tu conexión y vuelve a intentar.", reintentar: true });
  }, 25000);
  try {
    const entro = await auth.init();
    clearTimeout(vigilante);
    if (!entro) { porton({ entrar: true }); return; }
    if (!auth.cuentaPermitida()) {
      porton({ error: `El portal es solo para cuentas ${PORTAL.dominio}. Iniciaste sesión con ${auth.account.username}.`, reintentar: true });
      $("reintentar").textContent = "Entrar con otra cuenta";
      accionReintentar = () => auth.salir();
      return;
    }
  } catch (error) {
    clearTimeout(vigilante);
    porton({ error: error.message, reintentar: true });
    return;
  }

  abrirPagina(auth.account.name || auth.account.username);
  await alEntrar?.();
}
