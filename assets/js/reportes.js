"use strict";

const APP = {
  // Origen de datos: listas de SharePoint del sitio timesheet, leidas por Microsoft Graph.
  graph: {
    base: "https://graph.microsoft.com/v1.0",
    clientId: "e122c4bd-0f08-48c1-a274-f55925229261",
    tenantId: "4ded6d76-6c1b-43eb-813b-423ecf957f15",
    // Sites.Manage.All y no Sites.Read.All: con un permiso de solo lectura la
    // aplicacion le recorta al propietario el derecho de saltarse el candado
    // "leer solo lo creado por el usuario", y el administrador veria solo lo
    // suyo. A los consultores no les amplia nada: su acceso real sigue siendo
    // el de su cuenta, y el candado de SharePoint los sigue limitando.
    scopes: ["User.Read", "Sites.Manage.All"],
    // Grupo de seguridad de Entra ID cuyos miembros son administradores.
    // Quien no pertenezca a el ve solo sus propias horas y no ve facturacion.
    adminGroupId: "6ee2df68-1c63-4303-b1ee-8367adbf035f",
    hostname: "clarilium.sharepoint.com",
    sitePath: "/sites/timesheet",
    lists: { timesheet: "Timesheet", clients: "Clientes", consultants: "Consultores" }
  },
  // Nombres visibles de las columnas de la lista Timesheet.
  // Los nombres internos se resuelven solos al arrancar, asi que los acentos y
  // espacios no importan: basta con que coincida el nombre que se ve en SharePoint.
  columns: {
    horasDe: "Horas de",
    fecha: "Fecha",
    cliente: "Cliente",
    horas: "Horas",
    requerimiento: "Requerimiento",
    actividad: "Tipo de actividad",
    nota: "Nota",
    asignadoA: "Asignado a"
  },
  // Posibles nombres de la columna de nombre en cada catalogo, en orden de preferencia.
  catalogColumns: {
    clients: ["Subcliente", "Cliente", "Nombre del cliente", "Title"],
    consultants: ["Consultor", "Nombre y Apellido", "Nombre", "Title"]
  },
  required: [
    "Marca temporal", "Cliente", "Fecha", "Horas", "Requerimiento",
    "Tipo de actividad", "Desarrollador", "Nota", "Comentarios adicionales (uso interno)"
  ],
  refreshMs: 300000,
  minRefreshMs: 60000,
  storageKey: "clarilium-timesheet-config-v1",
  colors: ["#9440FF", "#2590E7", "#B564FF", "#61B5F0", "#6B21A8", "#1667A8"],
};

function isDemo() { return window.location.protocol === "file:"; }

// Secciones que solo puede ver un administrador. Las tarifas viven dentro de
// estas dos vistas, asi que ocultarlas tambien oculta las tarifas.
const SECCIONES_ADMIN = ["clientBilling", "collabBilling"];

const DEFAULT_CONFIG = {
  theme: "light",
  clientRates: [],
  collabRates: [],
  manualAssignments: {},
  collaboratorSource: "developer"
};

const saved = readStorage();
const state = {
  records: [], invalidRows: [], rawRows: [], catalogs: { clients: [], developers: [] }, warnings: [],
  sourceName: "SharePoint", isAdmin: false, me: null, loadedAt: null, syncStatus: "loading", syncError: "", refreshPromise: null, dataSignature: "", filters: {}, charts: {},
  selectedClient: "", selectedConsultant: "", selectedConsultantClient: "",
  clientRates: Array.isArray(saved.clientRates) ? saved.clientRates : [],
  collabRates: Array.isArray(saved.collabRates) ? saved.collabRates : [],
  manualAssignments: saved.manualAssignments || {},
  collaboratorSource: saved.collaboratorSource || "developer",
};

class DataProvider {
  async load() { throw new Error("El proveedor debe implementar load()."); }
}

/* ------------------------------------------------------------------ *
 * Lectura desde SharePoint (Microsoft Graph)
 * ------------------------------------------------------------------ */

// Devuelve el texto de un campo de SharePoint sin importar si viene como
// cadena, como objeto de busqueda/persona o como lista de varios valores.
function lookupText(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map(lookupText).filter(Boolean).join(", ");
  if (typeof value === "object") {
    return clean(value.LookupValue ?? value.lookupValue ?? value.DisplayName ?? value.displayName
              ?? value.Title ?? value.title ?? value.Label ?? value.label ?? value.Email ?? "");
  }
  return clean(value);
}

class GraphDataProvider extends DataProvider {
  constructor(token) { super(); this.token = token; }

  async get(url) {
    let response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${this.token}`, Accept: "application/json" } });
    } catch {
      throw new Error("No se pudo contactar a Microsoft Graph. Revisa tu conexión a internet.");
    }
    if (response.status === 401) throw new Error("La sesión caducó. Vuelve a iniciar sesión.");
    if (response.status === 403) throw new Error("Tu cuenta no tiene permiso para leer el sitio de SharePoint “timesheet”.");
    if (response.status === 404) throw new Error("No se encontró el sitio o la lista en SharePoint. Verifica que el sitio timesheet y sus listas existan.");
    if (response.status === 429) throw new Error("SharePoint limitó temporalmente las consultas. Espera un momento y vuelve a actualizar.");
    if (!response.ok) throw new Error(`Microsoft Graph respondió HTTP ${response.status}.`);
    return response.json();
  }

  // Recorre todas las paginas de un resultado de Graph.
  async all(url) {
    const items = [];
    let next = url;
    while (next) {
      const page = await this.get(next);
      items.push(...(page.value || []));
      next = page["@odata.nextLink"] || null;
    }
    return items;
  }

  async siteId() {
    const site = await this.get(`${APP.graph.base}/sites/${APP.graph.hostname}:${APP.graph.sitePath}`);
    if (!site.id) throw new Error(`No se pudo resolver el sitio ${APP.graph.sitePath} en SharePoint.`);
    return site.id;
  }

  async lists(siteId) {
    const all = await this.all(`${APP.graph.base}/sites/${siteId}/lists?$select=id,name,displayName&$top=200`);
    const byName = new Map();
    all.forEach(list => {
      byName.set(norm(list.displayName), list);
      byName.set(norm(list.name), list);
    });
    return byName;
  }

  requireList(byName, wanted) {
    const list = byName.get(norm(wanted));
    if (!list) throw new Error(`Falta la lista “${wanted}” en el sitio de SharePoint.`);
    return list;
  }

  // Mapa de nombre visible -> nombre interno de columna.
  async columnMap(siteId, listId) {
    const columns = await this.all(`${APP.graph.base}/sites/${siteId}/lists/${listId}/columns?$select=name,displayName&$top=200`);
    const map = new Map();
    columns.forEach(column => {
      if (column.name) map.set(norm(column.name), column.name);
      if (column.displayName) map.set(norm(column.displayName), column.name);
    });
    return map;
  }

  async me() {
    return this.get(`${APP.graph.base}/me?$select=displayName,userPrincipalName,mail`);
  }

  async itemFields(siteId, listId) {
    const items = await this.all(`${APP.graph.base}/sites/${siteId}/lists/${listId}/items?$expand=fields&$top=200`);
    return items;
  }

  // Lee un catalogo probando los nombres de columna configurados, en orden.
  // Devuelve los valores y, sobre todo, el mapa id -> texto: es lo que permite
  // resolver las columnas de busqueda de la lista Timesheet, porque Graph
  // entrega la referencia (…LookupId) y no siempre el texto.
  async catalog(siteId, byName, listKey, warnings) {
    const wanted = APP.graph.lists[listKey];
    const vacio = { valores: [], porId: new Map() };
    const list = byName.get(norm(wanted));
    if (!list) { warnings.push(`Falta la lista de catálogo “${wanted}”.`); return vacio; }
    const map = await this.columnMap(siteId, list.id);
    const items = await this.itemFields(siteId, list.id);
    for (const candidate of APP.catalogColumns[listKey]) {
      const internal = map.get(norm(candidate));
      if (!internal) continue;
      const porId = new Map();
      items.forEach(item => {
        const texto = lookupText(item.fields?.[internal]);
        if (texto) porId.set(String(item.id), texto);
      });
      if (porId.size) {
        if (norm(candidate) !== norm(APP.catalogColumns[listKey][0])) {
          warnings.push(`En “${wanted}” se usó la columna “${candidate}” para los nombres.`);
        }
        return { valores: unique([...porId.values()]).sort((a, b) => a.localeCompare(b, "es")), porId };
      }
    }
    warnings.push(`No se encontró una columna de nombre utilizable en “${wanted}”.`);
    return vacio;
  }

  async load() {
    const warnings = [];
    state.me = await this.me();
    state.isAdmin = auth.isAdmin();
    applyRoleVisibility();
    const siteId = await this.siteId();
    const byName = await this.lists(siteId);

    // Los catalogos van primero: sus mapas id -> texto son los que resuelven
    // las columnas de busqueda de la lista Timesheet.
    const catClientes = await this.catalog(siteId, byName, "clients", warnings);
    const catConsultores = await this.catalog(siteId, byName, "consultants", warnings);

    const timesheet = this.requireList(byName, APP.graph.lists.timesheet);
    const map = await this.columnMap(siteId, timesheet.id);

    const faltantes = Object.entries(APP.columns)
      .filter(([, visible]) => !map.has(norm(visible)))
      .map(([, visible]) => visible);
    if (faltantes.length) {
      throw new Error(`Faltan columnas en la lista Timesheet: ${faltantes.join(", ")}.`);
    }

    const items = await this.itemFields(siteId, timesheet.id);
    const interno = clave => map.get(norm(APP.columns[clave]));

    // Una columna de busqueda o de persona puede llegar de tres formas:
    // como texto, como objeto con LookupValue, o solo como "<columna>LookupId".
    // Esta funcion cubre las tres.
    const valor = (fields, clave, catalogo) => {
      const nombre = interno(clave);
      const directo = lookupText(fields[nombre]);
      if (directo) return directo;
      const id = fields[`${nombre}LookupId`];
      if (id == null) return "";
      if (catalogo) return catalogo.porId.get(String(id)) || "";
      return "";
    };

    const rows = items.map(item => {
      const fields = item.fields || {};
      const autor = item.createdBy?.user || {};
      // "Horas de" siempre coincide con quien capturo, asi que si la columna no
      // trae texto, el autor del elemento es una fuente fiable y exacta.
      const horasDe = valor(fields, "horasDe") || clean(autor.displayName);
      const asignadoA = valor(fields, "asignadoA", catConsultores);
      return {
        "Marca temporal": item.createdDateTime || fields.Created || null,
        "Cliente": valor(fields, "cliente", catClientes),
        "Fecha": fields[interno("fecha")] ?? null,
        "Horas": fields[interno("horas")] ?? null,
        "Requerimiento": clean(fields[interno("requerimiento")]),
        "Tipo de actividad": lookupText(fields[interno("actividad")]),
        // Regla de reporte: se muestra "Asignado a" cuando tiene valor.
        "Desarrollador": asignadoA || horasDe,
        "Nota": clean(fields[interno("nota")]),
        "Comentarios adicionales (uso interno)": "",
        // Se conservan ambos nombres: el pago se calcula por "Horas de".
        _horasDe: horasDe,
        _horasDeCorreo: norm(autor.email || ""),
        _asignadoA: asignadoA,
        _itemId: item.id
      };
    });

    if (!rows.length) warnings.push("La lista Timesheet no tiene registros todavía.");

    // Diagnostico: se guarda la forma cruda de los primeros elementos, que es
    // lo unico que permite ver como entrega Graph cada columna.
    state.diagnostico = {
      columnas: Object.fromEntries(Object.keys(APP.columns).map(k => [APP.columns[k], interno(k)])),
      totalElementos: items.length,
      catalogos: { clientes: catClientes.porId.size, consultores: catConsultores.porId.size },
      muestra: items.slice(0, 3).map(i => ({ id: i.id, createdBy: i.createdBy?.user, fields: i.fields })),
      convertidos: rows.slice(0, 3)
    };

    let clients = catClientes.valores;
    let consultants = catConsultores.valores;

    // A partir de aqui se recorta lo que devuelve el proveedor segun el rol,
    // para que las horas ajenas no lleguen siquiera a la memoria del tablero.
    let visibles = rows;
    if (!state.isAdmin) {
      const miNombre = norm(state.me?.displayName);
      const miCorreo = norm(state.me?.mail || state.me?.userPrincipalName);
      // El correo es la comparacion buena; el nombre queda como respaldo.
      visibles = rows.filter(row =>
        (row._horasDeCorreo && row._horasDeCorreo === miCorreo) ||
        (Boolean(row._horasDe) && norm(row._horasDe) === miNombre));
      if (rows.length && !visibles.length) {
        warnings.push(`No se encontraron horas capturadas a tu nombre (“${state.me?.displayName || "sin nombre"}”).`);
      }
      consultants = unique(visibles.map(row => row._horasDe));
      clients = unique(visibles.map(row => row["Cliente"])).sort((a, b) => a.localeCompare(b, "es"));
    }

    return {
      rows: visibles, clients, developers: consultants, warnings,
      sourceName: `SharePoint · ${APP.graph.lists.timesheet}`
    };
  }
}

/* ------------------------------------------------------------------ *
 * Modo demo: datos inventados para revisar la página desde el disco.
 * ------------------------------------------------------------------ */
class DemoDataProvider extends DataProvider {
  async load() {
    const clients = ["ACME Manufactura", "Delta Retail", "Nexo Salud", "Orbis Logística"];
    const consultants = ["Ana Demo", "Luis Demo", "Sofía Demo"];
    const activities = ["Desarrollo", "Análisis", "Soporte", "Pruebas"];
    const rows = [];
    const hoy = new Date();
    // Generador Park-Miller: módulo primo y multiplicador chico, para que la
    // distribución sea pareja y no se pierda precisión numérica.
    let semilla = 20260920;
    const azar = max => { semilla = (semilla * 16807) % 2147483647; return semilla % max; };
    for (let atras = 0; atras < 75; atras += 1) {
      const fecha = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - atras));
      if (fecha.getUTCDay() === 0 || fecha.getUTCDay() === 6) continue;
      for (let n = 0, total = 1 + azar(3); n < total; n += 1) {
        const quien = consultants[azar(consultants.length)];
        rows.push({
          "Marca temporal": fecha.toISOString(),
          "Cliente": clients[azar(clients.length)],
          "Fecha": fecha.toISOString().slice(0, 10),
          "Horas": 1 + azar(7),
          "Requerimiento": String(4100 + azar(90)),
          "Tipo de actividad": activities[azar(activities.length)],
          "Desarrollador": quien,
          "Nota": "Registro de ejemplo, no corresponde a datos reales.",
          "Comentarios adicionales (uso interno)": "",
          _horasDe: quien,
          _asignadoA: "",
          _itemId: `demo-${rows.length + 1}`
        });
      }
    }
    return {
      rows, clients, developers: consultants,
      warnings: ["Modo demo: la información es inventada y no proviene de SharePoint."],
      sourceName: "Datos de ejemplo (modo demo)"
    };
  }
}

/* ------------------------------------------------------------------ *
 * Inicio de sesion con la cuenta de CLARILIUM (MSAL)
 * ------------------------------------------------------------------ */
const auth = {
  client: null, account: null,

  async init() {
    if (!window.msal) throw new Error("No se pudo cargar la biblioteca de inicio de sesión de Microsoft. Revisa tu conexión.");
    this.client = new msal.PublicClientApplication({
      auth: {
        clientId: APP.graph.clientId,
        authority: `https://login.microsoftonline.com/${APP.graph.tenantId}`,
        redirectUri: window.location.origin + window.location.pathname,
        // Tras iniciar sesion, regresar a la direccion exacta de la que se
        // salio, con sus parametros (por ejemplo ?diagnostico=1).
        navigateToLoginRequestUrl: true
      },
      // localStorage: la sesion sobrevive a recargas y pestanas nuevas, asi
      // que no hay que volver a entrar ni esperar la verificacion silenciosa.
      // Es aceptable porque la politica de seguridad de /reportes solo admite
      // scripts del propio sitio.
      cache: { cacheLocation: "localStorage" }
    });
    await this.client.initialize();

    const resultado = await this.client.handleRedirectPromise();
    if (resultado?.account) this.client.setActiveAccount(resultado.account);

    let cuenta = this.client.getActiveAccount() || this.client.getAllAccounts()[0] || null;
    if (!cuenta) {
      // Si ya hay sesion de Microsoft 365 abierta, entra sin pedir contrasena.
      // Con limite de tiempo: sin red, ssoSilent puede tardar ~20 s en rendirse.
      const conLimite = (promesa, ms) => Promise.race([
        promesa,
        new Promise((_, rechazar) => setTimeout(() => rechazar(new Error("tiempo agotado")), ms))
      ]);
      try { cuenta = (await conLimite(this.client.ssoSilent({ scopes: APP.graph.scopes }), 5000)).account; }
      catch { cuenta = null; }
    }
    if (cuenta) this.client.setActiveAccount(cuenta);
    this.account = cuenta;
    return Boolean(cuenta);
  },

  // El rol sale de la notificacion de grupos del token de identidad.
  // Ante cualquier duda se devuelve false: el acceso amplio nunca se asume.
  isAdmin() {
    const claims = this.account?.idTokenClaims || {};
    if (!Array.isArray(claims.groups)) return false;
    return claims.groups.includes(APP.graph.adminGroupId);
  },

  signIn() { return this.client.loginRedirect({ scopes: APP.graph.scopes }); },
  signOut() { return this.client.logoutRedirect({ account: this.account }); },

  async token() {
    const peticion = { scopes: APP.graph.scopes, account: this.account };
    try {
      return (await this.client.acquireTokenSilent(peticion)).accessToken;
    } catch {
      await this.client.acquireTokenRedirect(peticion);
      throw new Error("Renovando la sesión…");
    }
  }
};

function showGate(mensaje) {
  document.getElementById("authGate").classList.remove("auth-gate--oculto");
  const error = document.getElementById("authError");
  error.textContent = mensaje || "";
  error.classList.toggle("show", Boolean(mensaje));
}

function hideGate() { document.getElementById("authGate").classList.add("auth-gate--oculto"); }

// Mientras se resuelve la sesion se muestra el circulo de progreso y se
// esconde el boton: ofrecer "iniciar sesion" antes de tiempo solo confunde.
function setGateChecking(activo) {
  const [girando, texto, entrar] = ["authSpinner", "authMsg", "signIn"].map(id => document.getElementById(id));
  if (girando) girando.hidden = !activo;
  if (texto) texto.hidden = activo;
  if (entrar) entrar.hidden = activo;
}

// Version de los tres archivos. Se inyecta al publicar en el HTML, el CSS y
// el JS a la vez; si no coinciden, la pagina lo dice en vez de fallar callada.
const VERSION_REPORTES = "2026.09.20-5";

function versionesPublicadas() {
  const html = document.querySelector('meta[name="reportes-version"]')?.content || "sin versión";
  const css = getComputedStyle(document.documentElement)
    .getPropertyValue("--reportes-version").trim().replace(/["']/g, "") || "sin versión";
  return { html, css, js: VERSION_REPORTES };
}

// Muestra un fallo en el porton. Nada aqui puede lanzar otro error: es la
// ultima red de seguridad, asi que todo acceso al documento es tolerante.
function mostrarFalla(mensaje) {
  document.getElementById("authGate")?.classList.remove("auth-gate--oculto");
  ["authSpinner", "authMsg", "signIn"].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
  const reintentar = document.getElementById("retry");
  if (reintentar) reintentar.hidden = false;
  const error = document.getElementById("authError");
  if (error) { error.textContent = mensaje; error.classList.add("show"); }
}

function renderAccountChip() {
  const chip = document.getElementById("accountChip");
  if (!auth.account) { chip.hidden = true; return; }
  document.getElementById("accountName").textContent = auth.account.name || auth.account.username || "";
  document.getElementById("accountRole").textContent = state.isAdmin ? "Administrador" : "Consultor";
  chip.hidden = false;
}

// Oculta del menu y del documento las secciones reservadas al administrador.
function applyRoleVisibility() {
  const admin = state.isAdmin;
  SECCIONES_ADMIN.forEach(nombre => {
    document.querySelectorAll(`.nav-item[data-view="${nombre}"]`).forEach(boton => { boton.hidden = !admin; });
    const vista = document.getElementById(`view-${nombre}`);
    if (!vista) return;
    vista.hidden = !admin;
    if (!admin) vista.classList.remove("active");
  });
  const actual = document.querySelector(".view.active")?.dataset.section;
  if (!admin && (!actual || SECCIONES_ADMIN.includes(actual))) setView("summary");
  renderAccountChip();
}

function readStorage() {
  try { return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(APP.storageKey) || "{}") }; }
  catch { return { ...DEFAULT_CONFIG }; }
}

function saveStorage() {
  try {
    localStorage.setItem(APP.storageKey, JSON.stringify({
      theme: document.body.classList.contains("dark") ? "dark" : "light",
      clientRates: state.clientRates, collabRates: state.collabRates,
      manualAssignments: state.manualAssignments, collaboratorSource: state.collaboratorSource
    }));
  } catch { /* Algunos navegadores restringen localStorage para archivos locales. */ }
}

function clean(value) { return value == null ? "" : String(value).replace(/\s+/g, " ").trim(); }
function norm(value) { return clean(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c])); }
function unique(values) { return [...new Set(values.filter(v => v !== "" && v != null))]; }
function sum(records) { return records.reduce((total, row) => total + row.hours, 0); }
function fmtHours(value) { const n = Number(value) || 0; return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""); }
function toISO(date) { return date ? date.toISOString().slice(0, 10) : ""; }
function formatDate(date) { return date ? new Intl.DateTimeFormat("es-MX", { day:"2-digit", month:"2-digit", year:"numeric", timeZone:"UTC" }).format(date) : "—"; }
function monthKey(date) { return date ? `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,"0")}` : ""; }
function currentMonthKey() { const now=new Date(); return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`; }
function monthLabel(key) { if (!key) return "Todos los periodos"; const [y,m] = key.split("-").map(Number); return new Intl.DateTimeFormat("es-MX", { month:"long", year:"numeric", timeZone:"UTC" }).format(new Date(Date.UTC(y,m-1,1))).replace(/^./, c => c.toUpperCase()); }
function money(minor, currency="MXN") { return new Intl.NumberFormat("es-MX", { style:"currency", currency, minimumFractionDigits:2, maximumFractionDigits:2 }).format((minor || 0) / 100); }
function toMinor(amount) { return Math.round((Number(amount) || 0) * 100); }
function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  if (typeof value === "number" && Number.isFinite(value)) return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000);
  const text = clean(value);
  if (!text) return null;
  let match = text.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (match) return validUTC(+match[3], +match[2], +match[1]);
  match = text.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (match) return validUTC(+match[1], +match[2], +match[3]);
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

function validUTC(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

function normalizePayload(payload) {
  const invalidRows = [];
  const records = payload.rows.map((row, index) => {
    const date = parseDate(row["Fecha"]);
    const rawHours = typeof row["Horas"] === "string" ? row["Horas"].replace(",", ".") : row["Horas"];
    const hours = Number(rawHours);
    const reasons = [];
    if (!date) reasons.push("Fecha no interpretable");
    if (!Number.isFinite(hours) || hours <= 0) reasons.push("Horas vacías, no numéricas o no positivas");
    const record = {
      id: row._itemId ? `sp-${row._itemId}` : `row-${index + 2}`, rowNumber: index + 2, timestamp: row["Marca temporal"],
      client: clean(row["Cliente"]), date, hours, requirement: clean(row["Requerimiento"]),
      activity: clean(row["Tipo de actividad"]), consultant: clean(row["Desarrollador"]),
      note: clean(row["Nota"]), internal: clean(row["Comentarios adicionales (uso interno)"]), original: row
    };
    if (reasons.length) invalidRows.push({ ...record, reasons });
    return reasons.length ? null : record;
  }).filter(Boolean);
  return { records, invalidRows };
}

function dataSignature(records,catalogs) {
  return JSON.stringify({
    records:records.map(r=>[r.id,r.timestamp,r.client,toISO(r.date),r.hours,r.requirement,r.activity,r.consultant,r.note,r.internal]),
    clients:catalogs.clients,
    developers:catalogs.developers
  });
}

function loadPayload(payload, { preserveUi=false }={}) {
  const uiState = preserveUi ? captureUiState() : null;
  const normalized = normalizePayload(payload);
  const catalogs={clients:payload.clients||[],developers:payload.developers||[]};
  const signature=dataSignature(normalized.records,catalogs);
  const unchanged=preserveUi&&signature===state.dataSignature;
  state.rawRows = payload.rows;
  state.warnings = payload.warnings || [];
  state.sourceName = payload.sourceName || "Tiempos.xlsx";
  state.loadedAt = new Date();
  if(unchanged)return false;
  state.records = normalized.records;
  state.invalidRows = normalized.invalidRows;
  state.catalogs = catalogs;
  state.dataSignature = signature;
  state.selectedClient = uiState?.selectedClient || "";
  state.selectedConsultant = uiState?.selectedConsultant || "";
  state.selectedConsultantClient = uiState?.selectedConsultantClient || "";
  populateControls();
  if (uiState) restoreUiState(uiState);
  updateAll();
  return true;
}

function captureUiState() {
  const ids = ["filterPeriod","filterFrom","filterTo","filterClient","filterConsultant","filterRequirement","filterActivity"];
  return {
    values: Object.fromEntries(ids.map(id=>[id,document.getElementById(id).value])),
    selectedClient: state.selectedClient,
    selectedConsultant: state.selectedConsultant,
    selectedConsultantClient: state.selectedConsultantClient
  };
}

function restoreUiState(uiState) {
  Object.entries(uiState.values).forEach(([id,value])=>{
    const control=document.getElementById(id);
    if(control.tagName==="SELECT"&&value&&![...control.options].some(option=>option.value===value))return;
    control.value=value;
  });
}

function optionList(values, selected="", allLabel="Todos") {
  return `<option value="">${esc(allLabel)}</option>` + values.map(v => `<option value="${esc(v)}"${v === selected ? " selected" : ""}>${esc(v)}</option>`).join("");
}

function populateControls() {
  const defaultPeriod=currentMonthKey();
  const periods = unique([defaultPeriod,...state.records.map(r => monthKey(r.date))]).sort().reverse();
  const clients = unique([...state.catalogs.clients, ...state.records.map(r => r.client)]).sort((a,b)=>a.localeCompare(b,"es"));
  const consultants = unique([...state.catalogs.developers, ...state.records.map(r => r.consultant)]).sort((a,b)=>a.localeCompare(b,"es"));
  const requirements = unique(state.records.map(r => r.requirement)).sort((a,b)=>a.localeCompare(b,"es",{numeric:true}));
  const activities = unique(state.records.map(r => r.activity)).sort((a,b)=>a.localeCompare(b,"es"));
  const periodControl=document.getElementById("filterPeriod");
  periodControl.innerHTML = `<option value="">Todos los periodos</option>` + periods.map(k => `<option value="${k}">${esc(monthLabel(k))}</option>`).join("");
  periodControl.value=defaultPeriod;
  document.getElementById("filterClient").innerHTML = optionList(clients);
  document.getElementById("filterConsultant").innerHTML = optionList(consultants);
  document.getElementById("filterRequirement").innerHTML = optionList(requirements);
  document.getElementById("filterActivity").innerHTML = optionList(activities);
  renderRateEditors();
  renderManualAssignments();
}

function collectFilters() {
  return {
    period: document.getElementById("filterPeriod").value,
    from: document.getElementById("filterFrom").value,
    to: document.getElementById("filterTo").value,
    client: document.getElementById("filterClient").value,
    consultant: document.getElementById("filterConsultant").value,
    requirement: document.getElementById("filterRequirement").value,
    activity: document.getElementById("filterActivity").value
  };
}

function resetFiltersToDefaults() {
  ["filterFrom","filterTo","filterClient","filterConsultant","filterRequirement","filterActivity"].forEach(id=>document.getElementById(id).value="");
  document.getElementById("filterPeriod").value=currentMonthKey();
  updateAll();
}

function applyFilters(records, overrides={}) {
  const f = { ...collectFilters(), ...overrides };
  return records.filter(r => {
    return (!f.period || monthKey(r.date) === f.period) &&
      (!f.from || toISO(r.date) >= f.from) && (!f.to || toISO(r.date) <= f.to) &&
      (!f.client || r.client === f.client) && (!f.consultant || r.consultant === f.consultant) &&
      (!f.requirement || r.requirement === f.requirement) && (!f.activity || r.activity === f.activity);
  });
}

function groupBy(records, keyFn) {
  const map = new Map();
  records.forEach(r => { const key = keyFn(r); if (!map.has(key)) map.set(key, []); map.get(key).push(r); });
  return map;
}

function updateAll() {
  state.filters = collectFilters();
  const rows = applyFilters(state.records);
  renderSummary(rows);
  renderClients(rows);
  renderConsultants(rows);
  renderApproval(rows);
  renderDiagnostico();
  if (state.isAdmin) {
    renderClientBilling(rows);
    renderCollabBilling(rows);
  }
}

function renderSummary(rows) {
  const total = sum(rows);
  const kpis = [
    ["Total de horas", fmtHours(total), `${rows.length} registros válidos`, "approval", "Ir al reporte mensual de horas"],
    ["Clientes con actividad", unique(rows.map(r=>r.client)).length, "con horas en el periodo", "clients", "Ir a horas por cliente"],
    ["Consultores con actividad", unique(rows.map(r=>r.consultant)).length, "participantes", "consultants", "Ir a horas por consultor"]
  ];
  document.getElementById("kpiGrid").innerHTML = kpis.map(([label,value,foot,view,ariaLabel])=>`<button type="button" class="kpi kpi--link" data-kpi-view="${view}" aria-label="${esc(ariaLabel)}"><span class="kpi__label">${esc(label)}</span><strong class="kpi__value">${esc(value)}</strong><span class="kpi__foot">${esc(foot)}</span></button>`).join("");
  const daily = [...groupBy(rows, r=>toISO(r.date))].map(([key,data])=>({key, label:formatDate(data[0].date), value:sum(data)})).sort((a,b)=>a.key.localeCompare(b.key));
  drawChart("trendChart", {
    type:"line", data:{ labels:daily.map(d=>d.label), datasets:[{label:"Horas",data:daily.map(d=>d.value),borderColor:APP.colors[0],backgroundColor:"rgba(148,64,255,.14)",fill:true,tension:.28,pointRadius:4,pointHoverRadius:6}]},
    options:baseChartOptions({ yTitle:"Horas" })
  }, daily.map(d=>[d.label,d.value]));
  const activities = [...groupBy(rows,r=>r.activity || "Sin actividad")].map(([label,data])=>({label,value:sum(data)})).sort((a,b)=>b.value-a.value);
  drawChart("activityChart", { type:"doughnut", data:{labels:activities.map(d=>d.label),datasets:[{data:activities.map(d=>d.value),backgroundColor:activities.map((_,i)=>APP.colors[i%APP.colors.length]),borderWidth:0}]}, options:{responsive:true,maintainAspectRatio:false,animation:false,cutout:"63%",plugins:chartPlugins()} }, activities.map(d=>[d.label,d.value]));
}

function baseChartOptions(extra={}) {
  return { responsive:true, maintainAspectRatio:false, animation:false, interaction:{mode:"index",intersect:false},
    scales:{ x:{grid:{display:false},ticks:{color:chartTextColor()}}, y:{beginAtZero:true,grid:{color:chartGridColor()},ticks:{color:chartTextColor()},title:{display:Boolean(extra.yTitle),text:extra.yTitle,color:chartTextColor()}} },
    plugins:chartPlugins(), ...extra.options };
}
function chartPlugins() { return { legend:{position:"bottom",labels:{color:chartTextColor(),usePointStyle:true,boxWidth:8,padding:18}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label ? ctx.dataset.label+": " : ""}${fmtHours(ctx.raw)} h`}} }; }
function chartTextColor() { return document.body.classList.contains("dark") ? "#D1D2D4" : "#667085"; }
function chartGridColor() { return document.body.classList.contains("dark") ? "rgba(209,210,212,.10)" : "rgba(13,23,40,.08)"; }

function drawChart(id, config, fallbackData=[]) {
  if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
  const canvas = document.getElementById(id);
  const fallback = document.querySelector(`[data-for="${id}"]`);
  if (!window.Chart || !fallbackData.length) {
    canvas.style.display = "none"; fallback.style.display = "block";
    fallback.innerHTML = fallbackData.length ? fallbackBars(fallbackData, id) : `<p class="empty-cell">No hay datos para mostrar.</p>`;
    return;
  }
  canvas.style.display = "block"; fallback.style.display = "none";
  state.charts[id] = new Chart(canvas, config);
}

function fallbackBars(data, chartId="") {
  const max = Math.max(...data.map(d=>Number(d[1])||0), 1);
  return `<div class="fallback-bars">${data.map(([label,value,meta])=>{
    let action="";
    if(chartId==="clientChart")action=`data-client="${esc(label)}"`;
    if(chartId==="consultantChart")action=`data-consultant="${esc(label)}"`;
    if(chartId==="consultantMixChart"&&meta?.consultant&&meta?.client)action=`data-consultant="${esc(meta.consultant)}" data-consultant-client="${esc(meta.client)}"`;
    return `<div class="fallback-row">${action?`<button class="fallback-client" type="button" ${action}>${esc(label)}</button>`:`<span>${esc(label)}</span>`}<span class="fallback-track"><i class="fallback-fill" style="width:${Math.max(2,value/max*100)}%"></i></span><b class="num">${fmtHours(value)}</b></div>`;
  }).join("")}</div>`;
}

function renderClients(rows) {
  const items = [...groupBy(rows,r=>r.client || "Sin cliente")].map(([client,data])=>({
    client, hours:sum(data)
  })).sort((a,b)=>b.hours-a.hours);
  const wrap = document.getElementById("clientChart").parentElement;
  wrap.style.setProperty("--bars", items.length || 4);
  drawChart("clientChart", { type:"bar", data:{labels:items.map(i=>i.client),datasets:[{label:"Horas",data:items.map(i=>i.hours),backgroundColor:APP.colors[0],hoverBackgroundColor:APP.colors[2],borderRadius:5,barThickness:24}]}, options:{...baseChartOptions(),indexAxis:"y",interaction:{mode:"nearest",axis:"y",intersect:true},scales:{x:{beginAtZero:true,grid:{color:"rgba(255,255,255,.08)"},ticks:{color:"#D1D2D4"}},y:{grid:{display:false},ticks:{color:"#FFFFFF",font:{weight:"700"}}}},plugins:{...chartPlugins(),legend:{display:false},tooltip:{mode:"nearest",axis:"y",intersect:true,callbacks:{title:contexts=>contexts[0]?.label||"",label:context=>`Horas: ${fmtHours(context.raw)} h`}}}} }, items.map(i=>[i.client,i.hours]));
  if (state.selectedClient && items.some(item=>item.client===state.selectedClient)) renderClientDetail(state.selectedClient,rows);
  else hideClientDetail();
}

function clientLabelIndex(event,chart) {
  const scale=chart?.scales?.y;
  if(!scale||event.x<scale.left||event.x>scale.right||event.y<scale.top||event.y>scale.bottom)return -1;
  const value=scale.getValueForPixel(event.y);
  const index=typeof value==="number"?Math.round(value):chart.data.labels.indexOf(value);
  return index>=0&&index<chart.data.labels.length?index:-1;
}

function clientIndexFromPointer(event,chart) {
  const elements=chart.getElementsAtEventForMode(event,"nearest",{axis:"y",intersect:true},false);
  if(elements[0])return elements[0].index;
  const rect=chart.canvas.getBoundingClientRect();
  return clientLabelIndex({x:event.clientX-rect.left,y:event.clientY-rect.top},chart);
}

function showClientDetail(client,rows=applyFilters(state.records)) {
  state.selectedClient=client;
  renderClientDetail(client,rows);
  requestAnimationFrame(()=>document.getElementById("clientDetailPanel").scrollIntoView({behavior:"smooth",block:"start"}));
  toast(`Detalle de ${client}: ${rows.filter(r=>(r.client||"Sin cliente")===client).length} registros.`);
}

function renderClientDetail(client,rows) {
  const detail=rows.filter(r=>(r.client||"Sin cliente")===client).sort((a,b)=>a.date-b.date||a.requirement.localeCompare(b.requirement,"es",{numeric:true})||a.consultant.localeCompare(b.consultant,"es"));
  if(!detail.length)return hideClientDetail();
  const panel=document.getElementById("clientDetailPanel");
  document.getElementById("clientDetailTitle").textContent=`Reporte de horas — ${client}`;
  document.getElementById("clientDetailMeta").textContent=`${detail.length} registros · ${fmtHours(sum(detail))} h`;
  document.getElementById("clientDetailBody").innerHTML=detail.map(r=>`<tr><td><b>${esc(r.client||"Sin cliente")}</b></td><td>${esc(r.requirement)}</td><td>${esc(r.consultant)}</td><td>${formatDate(r.date)}</td><td class="num">${fmtHours(r.hours)}</td><td>${esc(r.activity)}</td><td>${esc(r.note)}</td></tr>`).join("");
  panel.hidden=false;
}

function hideClientDetail() {
  const panel=document.getElementById("clientDetailPanel");
  panel.hidden=true;
  document.getElementById("clientDetailBody").innerHTML="";
}

function renderConsultants(rows) {
  const total = sum(rows);
  const items = [...groupBy(rows,r=>r.consultant || "Sin consultor")].map(([name,data])=>{
    const capacity = capacityFor(name, state.filters.period || monthKey(data[0]?.date));
    const hours = sum(data); return { name, hours, capacity, available: capacity == null ? null : capacity-hours,
      clients:unique(data.map(r=>r.client)).length, requirements:unique(data.map(r=>r.requirement)).length, days:unique(data.map(r=>toISO(r.date))).length };
  }).sort((a,b)=>b.hours-a.hours);
  drawChart("consultantChart", {
    type:"bar",
    data:{labels:items.map(i=>i.name),datasets:[{label:"Horas",data:items.map(i=>i.hours),backgroundColor:APP.colors[0],hoverBackgroundColor:APP.colors[2],borderRadius:5}]},
    options:{
      ...baseChartOptions(),
      interaction:{mode:"nearest",axis:"x",intersect:true},
      plugins:{...chartPlugins(),legend:{display:false},tooltip:{mode:"nearest",axis:"x",intersect:true,callbacks:{title:contexts=>contexts[0]?.label||"",label:context=>`Horas: ${fmtHours(context.raw)} h`}}}
    }
  },items.map(i=>[i.name,i.hours]));
  const clients = unique(rows.map(r=>r.client||"Sin cliente")).sort();
  const byConsultant = groupBy(rows,r=>r.consultant||"Sin consultor");
  const datasets = clients.map((client,i)=>({label:client,backgroundColor:APP.colors[i%APP.colors.length],data:items.map(item=>sum((byConsultant.get(item.name)||[]).filter(r=>(r.client||"Sin cliente")===client))),borderWidth:0}));
  const mixFallback=items.flatMap(item=>clients.map(client=>{const hours=sum((byConsultant.get(item.name)||[]).filter(r=>(r.client||"Sin cliente")===client));return hours?[`${item.name} · ${client}`,hours,{consultant:item.name,client}]:null;}).filter(Boolean));
  drawChart("consultantMixChart", {
    type:"bar",
    data:{labels:items.map(i=>i.name),datasets},
    options:{
      ...baseChartOptions(),
      interaction:{mode:"nearest",axis:"xy",intersect:true},
      scales:{x:{stacked:true,grid:{display:false},ticks:{color:chartTextColor()}},y:{stacked:true,beginAtZero:true,grid:{color:chartGridColor()},ticks:{color:chartTextColor()}}},
      plugins:{...chartPlugins(),legend:{...chartPlugins().legend,onClick:(_event,legendItem,legend)=>selectConsultantClientFromLegend(legendItem,legend.chart)},tooltip:{mode:"nearest",axis:"xy",intersect:true,callbacks:{title:contexts=>{const context=contexts[0];return context?`${context.label} — ${context.dataset.label}`:"";},label:context=>`Horas: ${fmtHours(context.raw)} h`}}}
    }
  },mixFallback);
  document.getElementById("consultantTableBody").innerHTML = items.length ? items.map(i=>`<tr><td><b>${esc(i.name)}</b></td><td class="num">${fmtHours(i.hours)}</td><td class="num">${total?(i.hours/total*100).toFixed(1):"0.0"}%</td><td class="num">${i.clients}</td><td class="num">${i.requirements}</td><td class="num">${i.days}</td><td class="num">${i.capacity==null?"Pendiente":fmtHours(i.capacity)}</td><td class="num">${i.available==null?"—":fmtHours(i.available)}</td><td>${i.capacity?`<span class="progress-line"><span><i style="width:${Math.min(100,i.hours/i.capacity*100)}%"></i></span><b>${(i.hours/i.capacity*100).toFixed(1)}%</b></span>`:"Sin configurar"}</td></tr>`).join("") : emptyRow(9);
  if(state.selectedConsultant&&items.some(item=>item.name===state.selectedConsultant)){
    const selectedRows=byConsultant.get(state.selectedConsultant)||[];
    if(state.selectedConsultantClient&&!selectedRows.some(r=>(r.client||"Sin cliente")===state.selectedConsultantClient))state.selectedConsultantClient="";
    renderConsultantDetail(state.selectedConsultant,state.selectedConsultantClient,rows);
  }else hideConsultantDetail();
}

function consultantElementFromPointer(event,chart,axis="xy") {
  return chart?.getElementsAtEventForMode(event,"nearest",{axis,intersect:true},false)?.[0]||null;
}

function showConsultantDetail(consultant,client="",rows=applyFilters(state.records)) {
  const matches=rows.filter(r=>(r.consultant||"Sin consultor")===consultant&&(!client||(r.client||"Sin cliente")===client));
  if(!matches.length){toast(`No hay horas de ${consultant}${client?` para ${client}`:""} con los filtros actuales.`);return;}
  state.selectedConsultant=consultant;
  state.selectedConsultantClient=client;
  renderConsultantDetail(consultant,client,rows);
  requestAnimationFrame(()=>document.getElementById("consultantDetailPanel").scrollIntoView({behavior:"smooth",block:"start"}));
  toast(`Detalle de ${consultant}${client?` · ${client}`:""}: ${matches.length} registros.`);
}

function renderConsultantDetail(consultant,client,rows) {
  const detail=rows.filter(r=>(r.consultant||"Sin consultor")===consultant&&(!client||(r.client||"Sin cliente")===client)).sort((a,b)=>a.date-b.date||a.client.localeCompare(b.client,"es")||a.requirement.localeCompare(b.requirement,"es",{numeric:true}));
  if(!detail.length)return hideConsultantDetail();
  const panel=document.getElementById("consultantDetailPanel");
  document.getElementById("consultantDetailTitle").textContent=client?`Reporte de horas — ${consultant} · ${client}`:`Reporte de horas — ${consultant}`;
  document.getElementById("consultantDetailMeta").textContent=`${detail.length} registros · ${fmtHours(sum(detail))} h · según los filtros de análisis`;
  document.getElementById("consultantDetailBody").innerHTML=detail.map(r=>`<tr><td><b>${esc(r.client||"Sin cliente")}</b></td><td>${formatDate(r.date)}</td><td>${esc(r.requirement)}</td><td>${esc(r.consultant||"Sin consultor")}</td><td>${esc(r.activity)}</td><td>${esc(r.note)}</td><td class="num">${fmtHours(r.hours)}</td></tr>`).join("");
  panel.hidden=false;
}

function hideConsultantDetail() {
  state.selectedConsultant="";
  state.selectedConsultantClient="";
  const panel=document.getElementById("consultantDetailPanel");
  panel.hidden=true;
  document.getElementById("consultantDetailBody").innerHTML="";
}

function selectConsultantClientFromLegend(legendItem,chart) {
  const client=chart?.data?.datasets?.[legendItem.datasetIndex]?.label||"";
  if(!state.selectedConsultant)return toast("Selecciona primero la barra de un consultor.");
  showConsultantDetail(state.selectedConsultant,client);
}

function capacityFor(name, period) {
  const rate = state.collabRates.filter(r=>norm(r.name)===norm(name) && rateAppliesToPeriod(r,period)).sort((a,b)=>String(b.from||"").localeCompare(String(a.from||"")))[0];
  const value = Number(rate?.capacity); return Number.isFinite(value) && value > 0 ? value : null;
}

function rateAppliesToPeriod(rate, period) {
  if (!period) return true;
  const from = rate.from ? rate.from.slice(0,7) : "0000-00";
  const to = rate.to ? rate.to.slice(0,7) : "9999-99";
  return period >= from && period <= to;
}

function emptyRow(cols) { return `<tr><td colspan="${cols}" class="empty-cell">No hay datos que coincidan con los filtros.</td></tr>`; }

function exportRows(rows, format, title, filename) {
  if (!rows.length) { toast("No hay datos para exportar."); return; }
  if (format === "pdf") return exportRowsPdf(rows,title,filename);
  if (format === "xlsx" && window.XLSX) {
    const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"Reporte"); XLSX.writeFile(wb,`${filename}.xlsx`); return;
  }
  const headers = Object.keys(rows[0]);
  const csv = "\ufeff" + [headers,...rows.map(r=>headers.map(h=>r[h]))].map(line=>line.map(csvCell).join(",")).join("\r\n");
  downloadBlob(new Blob([csv],{type:"text/csv;charset=utf-8"}),`${filename}.csv`);
  if (format === "xlsx") toast("Excel no estaba disponible; se exportó CSV.");
}

function csvCell(v) { const s=String(v??""); return `"${s.replace(/"/g,'""')}"`; }
function downloadBlob(blob,name) { const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }

function exportRowsPdf(rows,title,filename) {
  if (!window.jspdf?.jsPDF) { toast("La biblioteca PDF no está disponible."); return; }
  const { jsPDF } = window.jspdf; const doc = new jsPDF({orientation:"landscape",unit:"mm",format:"letter"});
  if (typeof doc.autoTable !== "function") { toast("La extensión de tablas PDF no está disponible."); return; }
  const headers = Object.keys(rows[0]);
  doc.setFillColor(4,8,20); doc.rect(0,0,280,22,"F"); doc.setTextColor(255,255,255); doc.setFontSize(15); doc.text(title,14,14);
  doc.autoTable({head:[headers],body:rows.map(r=>headers.map(h=>r[h])),startY:28,theme:"striped",headStyles:{fillColor:[13,23,40],textColor:255},styles:{fontSize:7,cellPadding:2,overflow:"linebreak"},alternateRowStyles:{fillColor:[247,247,248]},margin:{left:10,right:10,bottom:12},rowPageBreak:"avoid",showHead:"everyPage",didDrawPage:({pageNumber})=>{doc.setTextColor(102,112,133);doc.setFontSize(7);doc.text(`Página ${pageNumber}`,270,210,{align:"right"});}});
  doc.save(`${filename}.pdf`);
}

function approvalRows() {
  return applyFilters(state.records);
}

function approvalData(rows=approvalRows()) {
  const sorted=[...rows].sort((a,b)=>(a.client||"").localeCompare(b.client||"","es",{numeric:true})||a.date-b.date||a.requirement.localeCompare(b.requirement,"es",{numeric:true})||a.consultant.localeCompare(b.consultant,"es"));
  return {
    headers:["Cliente","Fecha","Requerimiento","Consultor","Actividad","Nota","Horas"],
    rows:sorted.map(r=>[r.client||"Sin cliente",formatDate(r.date),r.requirement,r.consultant,r.activity,r.note||"—",fmtHours(r.hours)]),
    raw:sorted
  };
}

function approvalGroups(rows=approvalRows()) {
  const data=approvalData(rows);
  return [...groupBy(data.raw,row=>row.client||"Sin cliente")].map(([client,clientRows])=>({
    client,
    hours:sum(clientRows),
    rows:clientRows.map(r=>[r.client||"Sin cliente",formatDate(r.date),r.requirement,r.consultant,r.activity,r.note||"—",fmtHours(r.hours)])
  }));
}

function renderApproval(rows=approvalRows()) {
  const totalLabel=`${fmtHours(sum(rows))} horas`;
  document.getElementById("approvalDetailTotal").textContent=totalLabel;
  document.getElementById("approvalDetailTotalFooter").textContent=totalLabel;
  const groups=approvalGroups(rows);
  document.getElementById("approvalDetailBody").innerHTML=groups.length
    ? groups.map(group=>group.rows.map(row=>`<tr>${row.map((value,index)=>`<td class="${index===row.length-1?"num":""}">${esc(value)}</td>`).join("")}</tr>`).join("")+`<tr class="approval-client-total-row"><td colspan="7"><div class="approval-total-summary approval-overall-total approval-client-total-card"><b>Total de horas ${esc(group.client)}</b><strong>${fmtHours(group.hours)} horas</strong></div></td></tr>`).join("")
    : emptyRow(7);
}

function exportApprovalPdf() {
  const rows=approvalRows();
  if (!rows.length) return toast("No hay datos para exportar.");
  const data=approvalData(rows);
  const groups=approvalGroups(rows);
  const total=sum(rows);
  if (!window.confirm(`Se exportará un reporte con ${fmtHours(total)} horas. ¿Continuar?`)) return;
  if (!window.jspdf?.jsPDF) return toast("La biblioteca PDF no está disponible.");
  const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:"mm",format:"letter",orientation:"landscape"});
  if (typeof doc.autoTable !== "function") return toast("La extensión de tablas PDF no está disponible.");
  const width=doc.internal.pageSize.getWidth(); const height=doc.internal.pageSize.getHeight();
  const headerPages=new Set();
  const drawHeader=()=>{const page=doc.internal.getCurrentPageInfo().pageNumber;if(headerPages.has(page))return;headerPages.add(page);doc.setFillColor(4,8,20);doc.rect(0,0,width,24,"F");doc.setFillColor(148,64,255);doc.rect(0,0,width,3,"F");doc.setTextColor(255,255,255);doc.setFontSize(15);doc.text("CLARILIUM — Reporte mensual de horas",14,15);};
  const drawFooter=()=>{doc.setTextColor(102,112,133);doc.setFontSize(7);doc.text(`Página ${doc.internal.getCurrentPageInfo().pageNumber}`,width-10,height-7,{align:"right"});};
  const drawTotal=(label,hours,y)=>{doc.setFillColor(243,234,255);doc.rect(10,y,width-20,12,"F");doc.setFillColor(148,64,255);doc.rect(10,y,2,12,"F");doc.setTextColor(13,23,40);doc.setFontSize(10);doc.setFont("helvetica","bold");doc.text(label,16,y+8);doc.text(`${fmtHours(hours)} horas`,width-16,y+8,{align:"right"});doc.setFont("helvetica","normal");return y+18;};
  drawHeader();
  let y=drawTotal("Total de horas",total,30);
  const pdfBody=groups.flatMap(group=>[
    ...group.rows,
    [{content:`Total de horas ${group.client}`,colSpan:6,styles:{fillColor:[243,234,255],fontStyle:"bold",lineColor:[148,64,255],lineWidth:{top:.2,bottom:.2,left:1.2}}},{content:`${fmtHours(group.hours)} horas`,styles:{fillColor:[243,234,255],fontStyle:"bold",halign:"right",lineColor:[148,64,255],lineWidth:{top:.2,right:.2,bottom:.2}}}]
  ]);
  doc.autoTable({head:[data.headers],body:pdfBody,startY:y,margin:{top:30,left:10,right:10,bottom:16},theme:"striped",headStyles:{fillColor:[13,23,40],textColor:255},alternateRowStyles:{fillColor:[247,247,248]},styles:{fontSize:7,cellPadding:2,overflow:"linebreak"},columnStyles:{0:{cellWidth:25},1:{cellWidth:22},2:{cellWidth:29},3:{cellWidth:31},4:{cellWidth:32},5:{cellWidth:"auto"},6:{cellWidth:16,halign:"right"}},rowPageBreak:"avoid",showHead:"everyPage",willDrawPage:drawHeader,didDrawPage:drawFooter});
  y=doc.lastAutoTable.finalY+8;
  let footerNeedsPageNumber=false;
  if(y>height-30){doc.addPage();drawHeader();y=30;footerNeedsPageNumber=true;}
  drawTotal("Total de horas",total,y);
  if(footerNeedsPageNumber)drawFooter();
  const period=state.filters.period||"todos-los-periodos";
  doc.save(`reporte-aprobacion-${period}.pdf`);
}

function rateFor(name,date,rates,nameField="name") {
  const iso=toISO(date); return rates.filter(r=>norm(r[nameField])===norm(name) && (!r.from||iso>=r.from) && (!r.to||iso<=r.to) && Number(r.rate)>0).sort((a,b)=>String(b.from||"").localeCompare(String(a.from||"")))[0] || null;
}

function rateSignature(rate) { return rate ? [rate.id,rate.currency,rate.rate,rate.vat,rate.adjustmentType,rate.adjustmentValue,rate.from,rate.to].join("|") : "pending"; }
function calculateAmounts(hours,rate) {
  if (!rate) return {subtotal:0,vat:0,adjustment:0,total:0,currency:"MXN",pending:true};
  const subtotal=toMinor(hours*Number(rate.rate)); const vat=Math.round(subtotal*(Number(rate.vat)||0)/100);
  const adjustment=rate.adjustmentType==="percent"?Math.round(subtotal*(Number(rate.adjustmentValue)||0)/100):rate.adjustmentType==="amount"?toMinor(Number(rate.adjustmentValue)||0):0;
  return {subtotal,vat,adjustment,total:subtotal+vat+adjustment,currency:rate.currency||"MXN",pending:false};
}

function renderClientBilling(rows) {
  const groups=new Map();
  rows.forEach(r=>{const rate=rateFor(r.client,r.date,state.clientRates,"name");const key=[r.client,r.requirement,rateSignature(rate)].join("¦");if(!groups.has(key))groups.set(key,{client:r.client,requirement:r.requirement,rate,records:[]});groups.get(key).records.push(r);});
  const output=[...groups.values()].map(g=>{const hours=sum(g.records);return{...g,hours,...calculateAmounts(hours,g.rate)};}).sort((a,b)=>a.client.localeCompare(b.client)||a.requirement.localeCompare(b.requirement,"es",{numeric:true}));
  document.getElementById("clientBillingBody").innerHTML=output.length?output.map(r=>`<tr><td><b>${esc(r.client)}</b></td><td>${esc(r.requirement)}</td><td>${r.rate?`${esc(r.rate.from||"Inicio")} — ${esc(r.rate.to||"Actual")}`:"—"}</td><td class="num">${fmtHours(r.hours)}</td><td class="num">${r.rate?money(toMinor(r.rate.rate),r.currency)+"/h":"—"}</td><td class="num">${r.pending?"—":money(r.subtotal,r.currency)}</td><td class="num">${r.pending?"—":money(r.vat,r.currency)}</td><td class="num">${r.pending?"—":money(r.adjustment,r.currency)}</td><td class="num"><b>${r.pending?"—":money(r.total,r.currency)}</b></td><td><span class="status ${r.pending?"status--pending":"status--ok"}">${r.pending?"Tarifa pendiente":"Calculado"}</span></td></tr>`).join(""):emptyRow(10);
  renderBillingSummary("clientBillingSummary",output);
  state.clientBillingOutput=output;
}

function renderBillingSummary(id,output) {
  const pending=output.filter(r=>r.pending).reduce((a,r)=>a+r.hours,0);
  const currencies=groupBy(output.filter(r=>!r.pending),r=>r.currency);
  const cards=[`<article class="billing-card"><span>Horas consideradas</span><b>${fmtHours(output.reduce((a,r)=>a+r.hours,0))}</b></article>`,... [...currencies].map(([currency,rows])=>`<article class="billing-card"><span>Total estimado · ${esc(currency)}</span><b>${money(rows.reduce((a,r)=>a+r.total,0),currency)}</b></article>`),`<article class="billing-card warning"><span>Horas con tarifa pendiente</span><b>${fmtHours(pending)}</b></article>`];
  document.getElementById(id).innerHTML=cards.join("");
}

function parseCommentConsultant(record) {
  const match=record.internal.match(/^Horas\s+(.+)$/i); if(!match)return{value:record.consultant,warning:Boolean(record.internal)};
  const needle=norm(match[1]); const exact=state.catalogs.developers.find(d=>norm(d)===needle);
  if(exact)return{value:exact,warning:exact!==record.consultant};
  const firstMatches=state.catalogs.developers.filter(d=>norm(d).split(" ")[0]===needle);
  if(firstMatches.length===1)return{value:firstMatches[0],warning:firstMatches[0]!==record.consultant};
  return{value:record.consultant,warning:true,unmatched:true};
}

function attributedConsultant(record) {
  if(state.collaboratorSource==="manual")return state.manualAssignments[record.id]||record.consultant;
  if(state.collaboratorSource==="comment")return parseCommentConsultant(record).value;
  return record.consultant;
}

function renderCollabBilling(rows) {
  const discrepancy=rows.filter(r=>attributedConsultant(r)!==r.consultant);
  const unmatched=state.collaboratorSource==="comment"?rows.filter(r=>parseCommentConsultant(r).unmatched):[];
  const alert=document.getElementById("discrepancyAlert");
  if(discrepancy.length||unmatched.length){alert.hidden=false;alert.textContent=`${discrepancy.length} registros difieren del Desarrollador original. ${unmatched.length?`${unmatched.length} comentarios no coincidieron con el catálogo y conservaron el desarrollador.`:""} Cada registro se atribuye una sola vez.`;}else alert.hidden=true;
  document.getElementById("manualAssignmentsPanel").hidden=state.collaboratorSource!=="manual";
  const groups=new Map();
  rows.forEach(r=>{const name=attributedConsultant(r);const rate=rateFor(name,r.date,state.collabRates,"name");const key=[name,r.client,r.requirement,rateSignature(rate)].join("¦");if(!groups.has(key))groups.set(key,{name,client:r.client,requirement:r.requirement,rate,records:[]});groups.get(key).records.push(r);});
  const output=[...groups.values()].map(g=>{const hours=sum(g.records);return{...g,hours,capacity:Number(g.rate?.capacity)||null,...calculateAmounts(hours,g.rate)};}).sort((a,b)=>a.name.localeCompare(b.name)||a.client.localeCompare(b.client));
  document.getElementById("collabBillingBody").innerHTML=output.length?output.map(r=>`<tr><td><b>${esc(r.name)}</b></td><td>${esc(r.client)}</td><td>${esc(r.requirement)}</td><td class="num">${fmtHours(r.hours)}</td><td class="num">${r.capacity?fmtHours(r.capacity):"Pendiente"}</td><td class="num">${r.rate?money(toMinor(r.rate.rate),r.currency)+"/h":"—"}</td><td class="num">${r.pending?"—":money(r.subtotal,r.currency)}</td><td class="num">${r.pending?"—":money(r.vat,r.currency)}</td><td class="num">${r.pending?"—":money(r.adjustment,r.currency)}</td><td class="num"><b>${r.pending?"—":money(r.total,r.currency)}</b></td><td><span class="status ${r.pending?"status--pending":"status--ok"}">${r.pending?"Tarifa pendiente":"Calculado"}</span></td></tr>`).join(""):emptyRow(11);
  renderBillingSummary("collabBillingSummary",output); state.collabBillingOutput=output; renderManualAssignments(rows);
}

function renderRateEditors() {
  renderRateTable("clientRatesBody",state.clientRates,"client");
  renderRateTable("collabRatesBody",state.collabRates,"collab");
}

function rateSelect(values,current) { return values.map(v=>`<option value="${esc(v)}"${v===current?" selected":""}>${esc(v)}</option>`).join(""); }
function adjustmentSelect(current) {
  return [["none","Sin ajuste"],["percent","Porcentaje"],["amount","Importe"]].map(([value,label])=>`<option value="${value}"${value===current?" selected":""}>${label}</option>`).join("");
}
function renderRateTable(id,rates,type) {
  const names=type==="client"?unique([...state.catalogs.clients,...state.records.map(r=>r.client)]):unique([...state.catalogs.developers,...state.records.map(r=>r.consultant)]);
  document.getElementById(id).innerHTML=rates.length?rates.map(r=>`<tr data-rate-id="${esc(r.id)}" data-rate-type="${type}"><td><select data-field="name">${rateSelect(names.sort(),r.name)}</select></td><td><input data-field="rate" type="number" min="0" step="0.01" value="${esc(r.rate)}"></td><td><select data-field="currency">${rateSelect(["MXN","USD"],r.currency||"MXN")}</select></td><td><input data-field="vat" type="number" step="0.01" value="${esc(r.vat||0)}"></td><td><input data-field="adjustmentName" value="${esc(r.adjustmentName||"")}" placeholder="Retención/bono"></td><td><select data-field="adjustmentType">${adjustmentSelect(r.adjustmentType||"none")}</select></td><td><input data-field="adjustmentValue" type="number" step="0.01" value="${esc(r.adjustmentValue||0)}"></td>${type==="collab"?`<td><input data-field="capacity" type="number" min="0" step="0.5" value="${esc(r.capacity||"")}"></td>`:""}<td><input data-field="from" type="date" value="${esc(r.from||"")}"></td><td><input data-field="to" type="date" value="${esc(r.to||"")}"></td><td><button class="remove-row" type="button" aria-label="Eliminar tarifa">×</button></td></tr>`).join(""):emptyRow(type==="collab"?11:10);
}

function addRate(type) {
  const names=type==="client"?unique(state.records.map(r=>r.client)):unique(state.records.map(r=>r.consultant));
  const row={id:`rate-${Date.now()}-${Math.random().toString(16).slice(2)}`,name:names[0]||"",rate:"",currency:"MXN",vat:16,adjustmentName:"",adjustmentType:"none",adjustmentValue:0,capacity:type==="collab"?"":"",from:"",to:""};
  (type==="client"?state.clientRates:state.collabRates).push(row); saveStorage(); renderRateEditors(); updateAll();
}

function renderManualAssignments(rows=applyFilters(state.records)) {
  const options=state.catalogs.developers;
  document.getElementById("manualAssignmentsBody").innerHTML=rows.length?rows.map(r=>`<tr data-record-id="${esc(r.id)}"><td>${formatDate(r.date)}</td><td>${esc(r.client)}</td><td>${esc(r.requirement)}</td><td>${esc(r.consultant)}</td><td><select class="manual-select">${rateSelect(options,state.manualAssignments[r.id]||r.consultant)}</select></td></tr>`).join(""):emptyRow(5);
}

function billingExportRows(type) {
  const rows=type==="client"?(state.clientBillingOutput||[]):(state.collabBillingOutput||[]);
  return rows.map(r=>({
    [type==="client"?"Cliente":"Colaborador"]:type==="client"?r.client:r.name,
    ...(type==="collab"?{Cliente:r.client}:{}),Requerimiento:r.requirement,Horas:fmtHours(r.hours),
    Tarifa:r.rate?Number(r.rate.rate):"Tarifa pendiente",Moneda:r.currency,Subtotal:r.pending?"":(r.subtotal/100).toFixed(2),IVA:r.pending?"":(r.vat/100).toFixed(2),Ajustes:r.pending?"":(r.adjustment/100).toFixed(2),Total:r.pending?"":(r.total/100).toFixed(2),Estado:r.pending?"Tarifa pendiente":"Calculado"
  }));
}

// Vuelca la forma cruda de lo que entrega Graph. Existe porque adivinar como
// devuelve SharePoint cada tipo de columna cuesta mas que mirarlo.
function enDiagnostico() {
  return new URLSearchParams(window.location.search).get("diagnostico") === "1";
}

function renderDiagnostico() {
  const panel = document.getElementById("diagPanel");
  if (!panel) return;
  if (!enDiagnostico()) { panel.hidden = true; return; }
  panel.hidden = false;
  const invalidos = state.invalidRows.map(r => ({
    fila: r.rowNumber, id: r.id, razones: r.reasons,
    fecha: r.original?.["Fecha"], horas: r.original?.["Horas"]
  }));
  document.getElementById("diagOut").textContent = JSON.stringify({
    yo: state.me,
    rol: state.isAdmin ? "Administrador" : "Consultor",
    registrosValidos: state.records.length,
    registrosInvalidos: invalidos,
    avisos: state.warnings,
    ...(state.diagnostico || {})
  }, null, 2);
}

function toast(message) { const el=document.getElementById("toast");el.textContent=message;el.classList.add("show");clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove("show"),3200); }

async function updateFromProvider(provider,{silent=false,successLabel="Fuente actualizada"}={}) {
  if(state.refreshPromise)return state.refreshPromise;
  state.syncStatus="loading";
  state.syncError="";
  if(!silent)document.body.classList.add("loading");
  state.refreshPromise=(async()=>{
    try{
      const payload=await provider.load();
      state.syncStatus="ok";
      state.syncError="";
      loadPayload(payload,{preserveUi:Boolean(state.dataSignature)});
      if(!silent)toast(`${successLabel}: ${state.records.length} registros válidos.`);
      return true;
    }catch(error){
      state.syncStatus="error";
      state.syncError=error.message;
      if(!silent||!state.records.length)toast(error.message);
      return false;
    }finally{
      document.body.classList.remove("loading");
      state.refreshPromise=null;
    }
  })();
  return state.refreshPromise;
}

async function refreshRemoteData({silent=false, force=false}={}) {
  if (isDemo()) {
    return updateFromProvider(new DemoDataProvider(), { silent, successLabel: "Modo demo" });
  }
  if (!auth.account) return false;
  // Evita golpear SharePoint en cada clic: fuera de la actualización periódica
  // solo se vuelve a consultar si pasó el mínimo configurado.
  if (!force && state.loadedAt && Date.now() - state.loadedAt.getTime() < APP.minRefreshMs) return false;
  let token;
  try {
    token = await auth.token();
  } catch (error) {
    state.syncStatus = "error";
    state.syncError = error.message;
    if (!silent) toast(error.message);
    return false;
  }
  return updateFromProvider(new GraphDataProvider(token), { silent, successLabel: "SharePoint actualizado" });
}

function setView(view) {
  // Punto unico de navegacion: si la vista es de administrador y quien mira no
  // lo es, se cae al resumen. Cierra tambien las llamadas directas por consola.
  if (!state.isAdmin && SECCIONES_ADMIN.includes(view)) view = "summary";
  document.querySelectorAll(".view").forEach(el=>el.classList.toggle("active",el.dataset.section===view));
  document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
  document.getElementById("sidebar").classList.remove("open");document.getElementById("menuToggle").setAttribute("aria-expanded","false");
  if(view==="approval")renderApproval(); window.scrollTo({top:0,behavior:"smooth"});
}

function refreshSectionData() {
  return refreshRemoteData({silent:true});
}

function navigateToView(view) {
  setView(view);
  refreshSectionData();
}

function bindEvents() {
  document.querySelectorAll("[data-view]").forEach(el=>el.addEventListener("click",()=>navigateToView(el.dataset.view)));
  document.getElementById("kpiGrid").addEventListener("click",e=>{const card=e.target.closest("[data-kpi-view]");if(card)navigateToView(card.dataset.kpiView);});
  document.getElementById("menuToggle").addEventListener("click",e=>{const open=document.getElementById("sidebar").classList.toggle("open");e.currentTarget.setAttribute("aria-expanded",String(open));});
  ["filterPeriod","filterFrom","filterTo","filterClient","filterConsultant","filterRequirement","filterActivity"].forEach(id=>document.getElementById(id).addEventListener("change",updateAll));
  document.getElementById("clearFilters").addEventListener("click",resetFiltersToDefaults);
  document.querySelector('[data-for="clientChart"]').addEventListener("click",e=>{const button=e.target.closest("[data-client]");if(button)showClientDetail(button.dataset.client);});
  document.querySelector('[data-for="consultantChart"]').addEventListener("click",e=>{const button=e.target.closest("[data-consultant]");if(button)showConsultantDetail(button.dataset.consultant);});
  document.querySelector('[data-for="consultantMixChart"]').addEventListener("click",e=>{const button=e.target.closest("[data-consultant][data-consultant-client]");if(button)showConsultantDetail(button.dataset.consultant,button.dataset.consultantClient);});
  const clientChart=document.getElementById("clientChart");
  clientChart.addEventListener("mousemove",e=>{const chart=state.charts.clientChart;if(chart)chart.canvas.style.cursor=clientIndexFromPointer(e,chart)>=0?"pointer":"default";});
  clientChart.addEventListener("mouseleave",()=>{clientChart.style.cursor="default";});
  clientChart.addEventListener("click",e=>{const chart=state.charts.clientChart;if(!chart)return;const index=clientIndexFromPointer(e,chart);if(index>=0)showClientDetail(chart.data.labels[index]);});
  const consultantChart=document.getElementById("consultantChart");
  consultantChart.addEventListener("mousemove",e=>{const chart=state.charts.consultantChart;if(chart)chart.canvas.style.cursor=consultantElementFromPointer(e,chart,"x")?"pointer":"default";});
  consultantChart.addEventListener("mouseleave",()=>{consultantChart.style.cursor="default";});
  consultantChart.addEventListener("click",e=>{const chart=state.charts.consultantChart;if(!chart)return;const element=consultantElementFromPointer(e,chart,"x");if(element)showConsultantDetail(chart.data.labels[element.index]);});
  const consultantMixChart=document.getElementById("consultantMixChart");
  consultantMixChart.addEventListener("mousemove",e=>{const chart=state.charts.consultantMixChart;if(chart)chart.canvas.style.cursor=consultantElementFromPointer(e,chart,"xy")?"pointer":"default";});
  consultantMixChart.addEventListener("mouseleave",()=>{consultantMixChart.style.cursor="default";});
  consultantMixChart.addEventListener("click",e=>{const chart=state.charts.consultantMixChart;if(!chart)return;const element=consultantElementFromPointer(e,chart,"xy");if(!element)return;const consultant=chart.data.labels[element.index];const client=chart.data.datasets[element.datasetIndex]?.label;if(consultant&&client)showConsultantDetail(consultant,client);});
  document.getElementById("pdfApproval").addEventListener("click",exportApprovalPdf);
  document.getElementById("printApproval").addEventListener("click",()=>{const rows=approvalRows();if(!rows.length)return toast("No hay datos para imprimir.");if(window.confirm(`Se imprimirá un reporte con ${fmtHours(sum(rows))} horas. ¿Continuar?`))window.print();});
  document.getElementById("addClientRate").addEventListener("click",()=>addRate("client"));
  document.getElementById("addCollabRate").addEventListener("click",()=>addRate("collab"));
  ["clientRatesBody","collabRatesBody"].forEach(id=>{const body=document.getElementById(id);body.addEventListener("change",rateEditorChange);body.addEventListener("click",rateEditorRemove);});
  document.getElementById("collabSource").value=state.collaboratorSource;
  document.getElementById("collabSource").addEventListener("change",e=>{state.collaboratorSource=e.target.value;saveStorage();updateAll();});
  document.getElementById("manualAssignmentsBody").addEventListener("change",e=>{if(!e.target.classList.contains("manual-select"))return;state.manualAssignments[e.target.closest("tr").dataset.recordId]=e.target.value;saveStorage();updateAll();});
  document.querySelectorAll("[data-billing-export]").forEach(btn=>btn.addEventListener("click",()=>exportRows(billingExportRows(btn.dataset.billingExport),btn.dataset.format,btn.dataset.billingExport==="client"?"Facturación a clientes":"Pago a colaboradores",btn.dataset.billingExport==="client"?"facturacion-clientes":"pago-colaboradores")));
  document.getElementById("themeToggle").addEventListener("click",()=>{document.body.classList.toggle("dark");saveStorage();updateAll();});
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshRemoteData({silent:true});});
  window.addEventListener("focus",()=>refreshRemoteData({silent:true}));
  document.getElementById("refreshNow").addEventListener("click",()=>refreshRemoteData({force:true}));
  document.getElementById("signIn").addEventListener("click",()=>auth.signIn());
  document.getElementById("signOut").addEventListener("click",()=>auth.signOut());
}

function rateEditorChange(e) {
  const row=e.target.closest("[data-rate-id]"); if(!row||!e.target.dataset.field)return;
  const rates=row.dataset.rateType==="client"?state.clientRates:state.collabRates; const rate=rates.find(r=>r.id===row.dataset.rateId); if(!rate)return;
  rate[e.target.dataset.field]=e.target.value; saveStorage(); updateAll();
}
function rateEditorRemove(e) {
  const btn=e.target.closest(".remove-row");if(!btn)return;const row=btn.closest("[data-rate-id]");const key=row.dataset.rateType==="client"?"clientRates":"collabRates";state[key]=state[key].filter(r=>r.id!==row.dataset.rateId);saveStorage();renderRateEditors();updateAll();
}
async function init() {
  document.getElementById("retry")?.addEventListener("click", () => window.location.reload());
  // Vigilante: pase lo que pase, el circulo no puede girar para siempre.
  const vigilante = setTimeout(() => {
    const girando = document.getElementById("authSpinner");
    if (girando && !girando.hidden) {
      mostrarFalla("La conexión con Microsoft está tardando más de lo normal. Revisa tu conexión y vuelve a intentar.");
    }
  }, 25000);
  try {
    await iniciar();
  } catch (error) {
    console.error("Reportes: fallo al iniciar", error);
    mostrarFalla(`No se pudo iniciar la página. ${error.message}`);
  } finally {
    clearTimeout(vigilante);
  }
}

async function iniciar() {
  const v = versionesPublicadas();
  if (v.html !== VERSION_REPORTES || v.css !== VERSION_REPORTES) {
    throw new Error(`Los archivos publicados no coinciden entre sí (página ${v.html}, estilos ${v.css}, código ${v.js}). Hay que volver a publicar reportes.html, reportes.css y reportes.js juntos.`);
  }
  document.body.classList.toggle("dark",saved.theme==="dark");
  bindEvents();
  populateControls();
  updateAll();

  // Abierta desde el disco: no hay inicio de sesión posible, se muestra el modo demo.
  if (isDemo()) {
    setGateChecking(false);
    hideGate();
    document.getElementById("demoBanner").classList.add("show");
    document.getElementById("refreshNow").hidden = true;
    state.isAdmin = true;            // en demo se ve todo, para revisar el diseño
    applyRoleVisibility();
    await refreshRemoteData({ force: true });
    return;
  }

  // El porton se levanta ANTES de comprobar la sesion: nadie debe alcanzar a
  // ver el tablero mientras se resuelve, aunque la red tarde en responder.
  showGate();
  setGateChecking(true);
  try {
    const entro = await auth.init();
    setGateChecking(false);
    if (!entro) return;
  } catch (error) {
    setGateChecking(false);
    showGate(error.message);
    return;
  }

  hideGate();
  state.isAdmin = auth.isAdmin();
  applyRoleVisibility();
  await refreshRemoteData({ force: true });
  window.setInterval(()=>refreshRemoteData({silent:true}),APP.refreshMs);
}

init();

