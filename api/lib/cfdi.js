'use strict';

/**
 * Revision de la factura en el servidor: el XML debe ser un CFDI 4.0 timbrado,
 * el PDF debe abrir, no llevar contrasena ni JavaScript y tener texto, y el PDF
 * debe mostrar los datos del XML. Son las MISMAS reglas que aplica la pagina
 * (assets/js/facturacion.js); aqui se repiten porque lo que llega del navegador
 * nunca se da por bueno.
 *
 * Los mensajes van en espanol e ingles: { es, en }.
 */

const path = require('path');
const { pathToFileURL } = require('url');

const NS_CFDI = 'http://www.sat.gob.mx/cfd/4';
const NS_CFDI33 = 'http://www.sat.gob.mx/cfd/3';
const NS_TFD = 'http://www.sat.gob.mx/TimbreFiscalDigital';
const RE_RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/;
const RE_UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;
const PAGINAS_PDF = 10;

const m = (es, en) => ({ es, en });
class ErrorFactura extends Error {
  constructor(msg) { super(msg.es); this.msg = msg; }
}
const falla = (es, en) => { throw new ErrorFactura(m(es, en)); };

const plano = (v) => String(v ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '');

/* ------------------------------------------------------------------ *
 * Lector de XML estricto y pequeno. Suficiente para un CFDI: elementos,
 * atributos, texto, comentarios, CDATA e instrucciones de proceso. No
 * admite DOCTYPE ni entidades propias (asi no hay XXE ni "billion laughs").
 * Si el documento no esta bien formado, lanza un error.
 * ------------------------------------------------------------------ */
const NOMBRE = '[A-Za-z_][\\w.\\-]*(?::[A-Za-z_][\\w.\\-]*)?';
const RE_ETIQUETA = new RegExp(`<(${NOMBRE})((?:\\s+${NOMBRE}\\s*=\\s*(?:"[^"<]*"|'[^'<]*'))*)\\s*(/?)>`, 'y');
const RE_ATRIBUTO = new RegExp(`(${NOMBRE})\\s*=\\s*(?:"([^"<]*)"|'([^'<]*)')`, 'g');
const RE_CIERRE = new RegExp(`</(${NOMBRE})\\s*>`, 'y');
const RE_ENTIDAD = /&(?:(amp|lt|gt|quot|apos)|#(\d{1,7})|#x([0-9A-Fa-f]{1,6}));/g;

function decodificarEntidades(texto) {
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9A-Fa-f]{1,6});)/.test(texto)) throw new Error('entidad invalida');
  return texto.replace(RE_ENTIDAD, (_, nombre, dec, hex) => {
    if (nombre) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[nombre];
    const cp = dec ? Number(dec) : parseInt(hex, 16);
    if (cp > 0x10FFFF || cp === 0) throw new Error('caracter invalido');
    return String.fromCodePoint(cp);
  });
}

function leerXml(texto) {
  let i = 0;
  let raiz = null;
  const pila = [];
  const avanzar = (fin, desde) => {
    const j = texto.indexOf(fin, desde);
    if (j < 0) throw new Error('sin cierre');
    return j + fin.length;
  };

  while (i < texto.length) {
    const lt = texto.indexOf('<', i);
    const trozo = lt < 0 ? texto.slice(i) : texto.slice(i, lt);
    if (trozo) {
      if (!pila.length && trozo.trim()) throw new Error('texto fuera del elemento raiz');
      decodificarEntidades(trozo);
    }
    if (lt < 0) break;
    i = lt;

    if (texto.startsWith('<?', i)) { i = avanzar('?>', i + 2); continue; }
    if (texto.startsWith('<!--', i)) { i = avanzar('-->', i + 4); continue; }
    if (texto.startsWith('<![CDATA[', i)) {
      if (!pila.length) throw new Error('CDATA fuera del raiz');
      i = avanzar(']]>', i + 9); continue;
    }
    if (texto.startsWith('<!', i)) throw new Error('declaracion no admitida');

    RE_CIERRE.lastIndex = i;
    const cierre = RE_CIERRE.exec(texto);
    if (cierre) {
      const abierto = pila.pop();
      if (!abierto || abierto.nombre !== cierre[1]) throw new Error('etiquetas cruzadas');
      i += cierre[0].length;
      continue;
    }

    RE_ETIQUETA.lastIndex = i;
    const etiqueta = RE_ETIQUETA.exec(texto);
    if (!etiqueta) throw new Error('etiqueta mal formada');
    const padre = pila[pila.length - 1] || null;
    const atributos = {};
    const ns = Object.assign({}, padre ? padre.ns : { xml: 'http://www.w3.org/XML/1998/namespace' });
    for (const a of etiqueta[2].matchAll(RE_ATRIBUTO)) {
      if (Object.prototype.hasOwnProperty.call(atributos, a[1])) throw new Error('atributo repetido');
      const valor = decodificarEntidades(a[2] ?? a[3] ?? '');
      atributos[a[1]] = valor;
      if (a[1] === 'xmlns') ns[''] = valor;
      else if (a[1].startsWith('xmlns:')) ns[a[1].slice(6)] = valor;
    }
    const [prefijo, local] = etiqueta[1].includes(':') ? etiqueta[1].split(':') : ['', etiqueta[1]];
    if (!(prefijo in ns)) throw new Error('prefijo sin declarar');
    const nodo = { nombre: etiqueta[1], local, namespace: ns[prefijo], atributos, hijos: [], ns };
    if (padre) padre.hijos.push(nodo);
    else if (raiz) throw new Error('dos elementos raiz');
    else raiz = nodo;
    if (!etiqueta[3]) pila.push(nodo);
    i += etiqueta[0].length;
  }
  if (!raiz || pila.length) throw new Error('documento incompleto');
  return raiz;
}

function buscar(nodo, namespace, local) {
  if (nodo.namespace === namespace && nodo.local === local) return nodo;
  for (const h of nodo.hijos) {
    const r = buscar(h, namespace, local);
    if (r) return r;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * XML
 * ------------------------------------------------------------------ */
function analizarXml(buffer) {
  if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') falla('El archivo es un PDF con extensión .xml; sube el XML de la factura.', 'The file is a PDF with an .xml extension; upload the invoice XML.');
  let texto;
  try { texto = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { falla('El XML no está codificado en UTF-8; no es un CFDI válido.', 'The XML is not UTF-8 encoded; it is not a valid CFDI.'); }
  texto = texto.replace(/^﻿/, '');
  if (!texto.trim().startsWith('<')) falla('El archivo no es un XML.', 'The file is not an XML document.');
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) falla('El XML contiene declaraciones DOCTYPE/ENTITY; por seguridad no se acepta.', 'The XML contains DOCTYPE/ENTITY declarations; it is rejected for security reasons.');

  let raiz;
  try { raiz = leerXml(texto); }
  catch { falla('El XML está dañado o incompleto (no es un XML bien formado).', 'The XML is damaged or incomplete (not well-formed).'); }

  if (raiz.local !== 'Comprobante') falla('El XML no es un CFDI: falta el nodo Comprobante.', 'The XML is not a CFDI: the Comprobante node is missing.');
  if (raiz.namespace === NS_CFDI33) falla('El XML es un CFDI 3.3, que ya no está vigente. Sube la versión 4.0.', 'The XML is a CFDI 3.3, which is no longer valid. Upload version 4.0.');
  if (raiz.namespace !== NS_CFDI || raiz.atributos.Version !== '4.0') falla('El XML no es un CFDI versión 4.0.', 'The XML is not a CFDI version 4.0.');

  const hijo = (local) => raiz.hijos.find((n) => n.namespace === NS_CFDI && n.local === local);
  const emisor = hijo('Emisor');
  const receptor = hijo('Receptor');
  const tfd = buscar(raiz, NS_TFD, 'TimbreFiscalDigital');
  const a = raiz.atributos;

  const datos = {
    serie: (a.Serie || '').trim(),
    folio: (a.Folio || '').trim(),
    fecha: a.Fecha || '',
    total: a.Total || '',
    moneda: a.Moneda || '',
    emisorRfc: ((emisor && emisor.atributos.Rfc) || '').trim().toUpperCase(),
    emisorNombre: (emisor && emisor.atributos.Nombre) || '',
    receptorRfc: ((receptor && receptor.atributos.Rfc) || '').trim().toUpperCase(),
    uuid: ((tfd && tfd.atributos.UUID) || '').trim().toUpperCase()
  };

  const faltan = [];
  if (!emisor || !RE_RFC.test(datos.emisorRfc)) faltan.push(m('RFC del emisor', 'issuer RFC'));
  if (!receptor || !RE_RFC.test(datos.receptorRfc)) faltan.push(m('RFC del receptor', 'recipient RFC'));
  if (!/^\d+(\.\d+)?$/.test(datos.total)) faltan.push(m('total', 'total'));
  if (faltan.length) falla(`El CFDI no es válido: falta o está mal el ${faltan.map((f) => f.es).join(', ')}.`, `The CFDI is not valid: the ${faltan.map((f) => f.en).join(', ')} is missing or wrong.`);
  if (!tfd || !RE_UUID.test(datos.uuid)) falla('El XML no está timbrado: falta el Timbre Fiscal Digital (UUID).', 'The XML is not stamped: the Timbre Fiscal Digital (UUID) is missing.');
  return datos;
}

/* ------------------------------------------------------------------ *
 * PDF (pdf.js 4.10.38, copia local en api/lib/pdfjs)
 * ------------------------------------------------------------------ */
let pdfjs = null;
async function cargarPdfjs() {
  if (pdfjs) return pdfjs;
  // pdf.js usa process.getBuiltinModule (Node 20.16+). En versiones anteriores
  // se sustituye por require, que hace lo mismo para modulos internos.
  if (typeof process.getBuiltinModule !== 'function') process.getBuiltinModule = (n) => require(n);
  const base = path.join(__dirname, 'pdfjs');
  // El "worker" corre en el mismo proceso: nada de hilos ni archivos temporales.
  const worker = await import(pathToFileURL(path.join(base, 'pdf.worker.mjs')).href);
  globalThis.pdfjsWorker = worker;
  pdfjs = await import(pathToFileURL(path.join(base, 'pdf.mjs')).href);
  return pdfjs;
}

async function analizarPdf(buffer) {
  if (!buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) falla('El archivo no es un PDF (le falta la firma %PDF).', 'The file is not a PDF (the %PDF signature is missing).');
  const lib = await cargarPdfjs();

  let doc;
  try {
    doc = await lib.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      disableAutoFetch: true,
      stopAtErrors: false,
      verbosity: 0
    }).promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') falla('El PDF está protegido con contraseña. Sube uno sin contraseña.', 'The PDF is password-protected. Upload one without a password.');
    falla('El PDF está dañado o no se puede abrir.', 'The PDF is damaged or cannot be opened.');
  }

  try {
    if (!doc.numPages) falla('El PDF no tiene páginas.', 'The PDF has no pages.');
    if (await doc.getJSActions()) falla('El PDF contiene código JavaScript; por seguridad no se acepta.', 'The PDF contains JavaScript code; it is rejected for security reasons.');
    const partes = [];
    for (let n = 1; n <= Math.min(doc.numPages, PAGINAS_PDF); n++) {
      const pagina = await doc.getPage(n);
      const contenido = await pagina.getTextContent();
      partes.push(contenido.items.map((it) => it.str || '').join(' '));
    }
    const texto = partes.join('\n');
    if (plano(texto).length < 20) falla('El PDF no tiene texto seleccionable (parece una imagen escaneada). Sube la representación impresa que genera tu sistema de facturación.', 'The PDF has no selectable text (it looks like a scanned image). Upload the printed representation generated by your invoicing system.');
    return texto;
  } catch (e) {
    if (e instanceof ErrorFactura) throw e;
    falla('El PDF está dañado o no se puede leer.', 'The PDF is damaged or cannot be read.');
  } finally {
    await doc.destroy();
  }
}

/* ------------------------------------------------------------------ *
 * Cruce XML <-> PDF
 * ------------------------------------------------------------------ */
function importes(texto) {
  const unido = texto.replace(/(\d)\s+([.,]\d)/g, '$1$2').replace(/(\d[.,])\s+(\d)/g, '$1$2');
  return (unido.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || []).map((v) => Number(v.replace(/,/g, '')));
}

function cruzar(d, textoPdf) {
  const p = plano(textoPdf);
  const errores = [];
  const uuid = plano(d.uuid);
  if (!p.includes(uuid) && !p.replace(/-/g, '').includes(uuid.replace(/-/g, '')))
    errores.push(m(`El PDF no contiene el folio fiscal (UUID) ${d.uuid} del XML.`, `The PDF does not contain the fiscal folio (UUID) ${d.uuid} from the XML.`));
  if (!p.includes(plano(d.emisorRfc)))
    errores.push(m(`El PDF no contiene el RFC del emisor ${d.emisorRfc} del XML.`, `The PDF does not contain the issuer RFC ${d.emisorRfc} from the XML.`));
  if (!p.includes(plano(d.receptorRfc)))
    errores.push(m(`El PDF no contiene el RFC del receptor ${d.receptorRfc} del XML.`, `The PDF does not contain the recipient RFC ${d.receptorRfc} from the XML.`));
  const total = Number(d.total);
  if (!importes(textoPdf).some((v) => Math.abs(v - total) < 0.005)) {
    const f = (loc) => total.toLocaleString(loc, { minimumFractionDigits: 2, maximumFractionDigits: 6 });
    errores.push(m(`El PDF no muestra el total ${f('es-MX')} del XML.`, `The PDF does not show the total ${f('en-US')} from the XML.`));
  }
  if (d.folio && !p.includes(plano(d.folio)))
    errores.push(m(`El PDF no contiene el folio ${d.serie}${d.folio} del XML.`, `The PDF does not contain the folio ${d.serie}${d.folio} from the XML.`));
  else if (d.serie && !p.includes(plano(d.serie)))
    errores.push(m(`El PDF no contiene la serie ${d.serie} del XML.`, `The PDF does not contain the series ${d.serie} from the XML.`));
  return errores;
}

module.exports = { analizarXml, analizarPdf, cruzar, ErrorFactura, leerXml };
