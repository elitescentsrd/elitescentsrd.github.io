// Motor de detección de datos personales de Opaco.
// Trabaja solo con texto: recibe el texto de cada página y devuelve, para cada dato encontrado, su categoría, su posición
// (inicio y fin en el texto de la página), el valor y la confianza. Todo se ejecuta en el navegador del usuario.
//
// Qué combina:
//  - Validación matemática de los identificadores (letra del DNI/NIE, dígitos de control del IBAN, de la cuenta de 20
//    dígitos, del número de la Seguridad Social y de las tarjetas), para no confundir un DNI con un número cualquiera.
//  - Contexto: "D.", "Dña.", "Trabajador:", "con domicilio en", "fecha de nacimiento"... indican qué dato viene detrás.
//  - Diccionarios de nombres y apellidos frecuentes para reconocer personas sin ninguna otra pista.
//  - Propagación: si una persona aparece identificada una vez, se marcan también el resto de sus apariciones.
import { FIRST_NAMES, SURNAMES, NOT_NAME, COMPANY_SUFFIX, norm } from './nombres.js';

export const CATEGORIES = {
  nombre: { label: 'Nombres y apellidos', short: 'Nombre' },
  dni: { label: 'DNI / NIE', short: 'DNI/NIE' },
  telefono: { label: 'Teléfonos', short: 'Teléfono' },
  email: { label: 'Correos electrónicos', short: 'Email' },
  direccion: { label: 'Direcciones', short: 'Dirección' },
  cuenta: { label: 'Cuentas bancarias y tarjetas', short: 'Cuenta' },
  nacimiento: { label: 'Fechas de nacimiento', short: 'F. nacimiento' },
  nss: { label: 'Nº de la Seguridad Social', short: 'NSS' },
  manual: { label: 'Añadidos por ti', short: 'Manual' },
};

// Si dos detecciones se pisan, gana la de mayor prioridad (la más fiable).
const PRIORITY = { email: 9, cuenta: 8, dni: 7, nss: 6, telefono: 5, nacimiento: 4, direccion: 3, nombre: 2 };

// ------------------------------------------------------------------ validadores
const DNI_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
export function dniLetterOk(digits, letter) { return DNI_LETTERS[Number(digits) % 23] === letter.toUpperCase(); }

const IBAN_LENGTHS = { ES: 24, AD: 24, PT: 25, FR: 27, IT: 27, DE: 22, GB: 22, IE: 22, NL: 18, BE: 16, LU: 20, CH: 21, AT: 20, PL: 28, RO: 24, DK: 18, SE: 24, NO: 15, FI: 18, GR: 27, MC: 27, SM: 27, CZ: 24, SK: 24, HU: 28, BG: 22, HR: 21, SI: 19, LT: 20, LV: 21, EE: 20, MT: 31, CY: 28, GI: 23, LI: 21, IS: 26, MA: 28 };
export function ibanOk(raw) {
  const s = raw.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const len = IBAN_LENGTHS[s.slice(0, 2)];
  if (len && s.length !== len) return false;
  let m = 0;
  for (const ch of s.slice(4) + s.slice(0, 4)) {
    const v = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of v) m = (m * 10 + Number(d)) % 97;
  }
  return m === 1;
}

function cccDigit(ten) {
  const w = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(ten[i]) * w[i];
  const d = 11 - (sum % 11);
  return d === 11 ? 0 : d === 10 ? 1 : d;
}
export function cccOk(digits) {
  if (!/^\d{20}$/.test(digits)) return false;
  return cccDigit('00' + digits.slice(0, 8)) === Number(digits[8]) && cccDigit(digits.slice(10)) === Number(digits[9]);
}

export function luhnOk(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n; alt = !alt;
  }
  return sum % 10 === 0;
}

export function nssOk(prov, num, dc) {
  const p = Number(prov);
  if (p < 1 || p > 53) return false;
  const n = Number(num);
  const base = n < 10000000 ? p * 10000000 + n : Number(prov + num);
  return base % 97 === Number(dc) || Number(prov + num) % 97 === Number(dc);
}

// ------------------------------------------------------------------ utilidades
// Mayúsculas y sin tildes conservando la longitud (las posiciones deben seguir apuntando al mismo carácter).
const foldChar = ch => { const b = ch.normalize('NFD')[0] || ch; const u = b.toUpperCase(); return u.length === 1 ? u : b; };
export const fold = s => { let r = ''; for (let i = 0; i < s.length; i++) r += foldChar(s[i]); return r; };
const before = (text, i, n) => text.slice(Math.max(0, i - n), i);
const lineBefore = (text, i, n) => { const b = before(text, i, n); return b.slice(b.lastIndexOf('\n') + 1); };
const hit = (type, start, end, text, confidence, reason) => ({ type, start, end, text: text.slice(start, end), confidence, reason });

// ------------------------------------------------------------------ identificadores
function findEmails(text, out) {
  for (const m of text.matchAll(/(?<![\p{L}\d._%+-])[\p{L}\d][\p{L}\d._%+-]*@[\p{L}\d-]+(?:\.[\p{L}\d-]+)*\.\p{L}{2,}/gu)) out.push(hit('email', m.index, m.index + m[0].length, text, 0.99, 'Formato de correo electrónico'));
}

// Páginas escaneadas: el OCR suele leer la arroba como "O", "©" o "®", a veces partiendo el correo en dos líneas.
function findEmailsOcr(text, out) {
  const re = /(?<![\p{L}\d._%+-])([\p{L}\d][\p{L}\d._%+-]*[\p{L}\d])[ \t]*\n?[ \t]*(?:[©®@]|\(at\)|[O0Q](?=[ \t]*\n?[ \t]*[\p{Ll}\d]))[ \t]*\n?[ \t]*([\p{L}\d][\p{L}\d-]*(?:\.[\p{L}\d-]+)*\.(?:es|com|net|org|eu|cat|gal|eus|info|biz|io|co|me|pt|fr|de|it|uk))(?![\p{L}\d])/gu;
  for (const m of text.matchAll(re)) {
    if (!/[._\d]/.test(m[1]) && m[1].length < 4) continue;
    out.push(hit('email', m.index, m.index + m[0].length, text, 0.8, 'Correo electrónico leído de una imagen (revísalo)'));
  }
}

function findDni(text, out) {
  for (const m of text.matchAll(/(?<![\p{L}\d])(\d{1,2}\.?\d{3}\.?\d{3})[ .-]?([A-Za-z])(?![\p{L}\d])/gu)) {
    const digits = m[1].replace(/\./g, '');
    if (digits.length !== 8) continue;
    const ok = dniLetterOk(digits, m[2]);
    const ctx = /\b(D\.?\s?N\.?\s?I|N\.?\s?I\.?\s?F|DNI|NIF|documento)\b[^\n]{0,20}$/i.test(before(text, m.index, 40));
    if (ok) out.push(hit('dni', m.index, m.index + m[0].length, text, 0.99, 'DNI con letra de control correcta'));
    else if (ctx && m[2] === m[2].toUpperCase()) out.push(hit('dni', m.index, m.index + m[0].length, text, 0.7, 'Parece un DNI (la letra no coincide: revísalo)'));
  }
  for (const m of text.matchAll(/(?<![\p{L}\d])([XYZxyz])[ .-]?(\d{7})[ .-]?([A-Za-z])(?![\p{L}\d])/gu)) {
    const ok = dniLetterOk('XYZ'.indexOf(m[1].toUpperCase()) + m[2], m[3]);
    const ctx = /\b(N\.?\s?I\.?\s?E|NIE|NIF|pasaporte|tarjeta de residencia)\b[^\n]{0,20}$/i.test(before(text, m.index, 40));
    if (ok || ctx) out.push(hit('dni', m.index, m.index + m[0].length, text, ok ? 0.99 : 0.7, ok ? 'NIE con letra de control correcta' : 'Parece un NIE (la letra no coincide: revísalo)'));
  }
  // "DNI: 12345678" sin letra, o pasaporte.
  for (const m of text.matchAll(/\b(?:D\.?\s?N\.?\s?I\.?|NIF|N\.I\.F\.|pasaporte)\s*(?:n[º°o.]\s*)?[:.]?\s*(\d{8}|[A-Z]{2,3}\d{6,7})(?![\p{L}\d])/giu)) {
    const start = m.index + m[0].length - m[1].length;
    out.push(hit('dni', start, start + m[1].length, text, 0.85, 'Número de documento tras "DNI"/"pasaporte"'));
  }
}

function findIban(text, out) {
  // En documentos escaneados el OCR confunde a veces 0 con O y 1 con I: en la parte numérica se corrigen antes de
  // validar (los dígitos de control siguen descartando cualquier falso positivo).
  const digitish = ch => ch === 'O' ? '0' : ch === 'I' ? '1' : ch;
  for (const m of text.matchAll(/(?<![A-Za-z0-9])([A-Z]{2})([\dOI]{2})(?=[ -]?[A-Z0-9])/g)) {
    const want = IBAN_LENGTHS[m[1]];
    const numeric = m[1] === 'ES';
    let compact = m[1] + [...m[2]].map(digitish).join(''), i = m.index + 4, best = null;
    while (i < text.length && compact.length < 34) {
      const ch = text[i];
      if (/[A-Z0-9]/.test(ch)) { compact += numeric ? digitish(ch) : ch; if ((!want || compact.length === want) && compact.length >= 15 && ibanOk(compact)) { best = i + 1; if (want) break; } }
      else if ((ch === ' ' || ch === '-') && /[A-Z0-9]/.test(text[i + 1] || '') && /[A-Z0-9]/.test(text[i - 1] || '')) { /* separador */ }
      else break;
      i++;
      if (want && compact.length > want) break;
    }
    if (best) out.push(hit('cuenta', m.index, best, text, 0.99, 'IBAN con dígitos de control correctos'));
  }
  for (const m of text.matchAll(/(?<![\d])(\d{4})[ -]?(\d{4})[ -]?(\d{2})[ -]?(\d{10})(?![\d])/g)) {
    if (cccOk(m[1] + m[2] + m[3] + m[4])) out.push(hit('cuenta', m.index, m.index + m[0].length, text, 0.97, 'Cuenta bancaria (20 dígitos) con control correcto'));
  }
  for (const m of text.matchAll(/(?<![\d])(\d{4})[ -](\d{4})[ -](\d{4})[ -](\d{4})(?![\d])|(?<![\d])(\d{16})(?![\d])/g)) {
    const digits = m[0].replace(/\D/g, '');
    if (/^[3-6]/.test(digits) && luhnOk(digits)) out.push(hit('cuenta', m.index, m.index + m[0].length, text, 0.9, 'Número de tarjeta válido'));
  }
}

function findNss(text, out) {
  for (const m of text.matchAll(/(?<![\d/])(\d{2})([ /-]?)(\d{7,8})\2(\d{2})(?![\d/])/g)) {
    const ctx = /(afiliaci[oó]n|seguridad social|N\.?\s?A\.?\s?F|N\.?\s?U\.?\s?S\.?\s?S|\bS\.\s?S\.|\bNSS\b)[^\n]{0,25}$/i.test(before(text, m.index, 60));
    const ok = nssOk(m[1], m[3], m[4]);
    if (ok && (ctx || m[2])) out.push(hit('nss', m.index, m.index + m[0].length, text, ctx ? 0.98 : 0.8, 'Número de la Seguridad Social con control correcto'));
    else if (ctx) out.push(hit('nss', m.index, m.index + m[0].length, text, 0.75, 'Número tras "Seguridad Social" (revísalo)'));
  }
}

function findPhones(text, out) {
  const ctxRe = /(tel[eé]?f?\.?|tel[eé]fono|tfno\.?|tlf\.?|tfn\.?|m[oó]vil|m[oó]v\.?|fax|whatsapp|contacto|llamar)[^\n]{0,15}$/i;
  const re = /(?<![\d\p{L}+.,/])(?:(?:\+|00)\s?34[\s.-]?)?(?:[6789]\d{2}(?:[\s.-]?\d{3}){2}|[6789]\d{2}(?:[\s.-]?\d{2}){3}|[89]\d(?:[\s.-]?\d{3})(?:[\s.-]?\d{2}){2})(?![\d]|[.,]\d)/gu;
  for (const m of text.matchAll(re)) {
    const digits = m[0].replace(/\D/g, '').replace(/^(00)?34(?=\d{9}$)/, '');
    if (digits.length !== 9) continue;
    const ctx = ctxRe.test(before(text, m.index, 30));
    const prefixed = /^(\+|00)/.test(m[0]);
    const mobile = /^[67]/.test(digits);
    const conf = ctx || prefixed ? 0.97 : mobile ? 0.85 : 0.75;
    if (!ctx && !prefixed && !/[\s.-]/.test(m[0]) && /(factura|n[º°o]\.?|ref|pedido|c[oó]digo|expediente|cif|nif)[^\n]{0,12}$/i.test(before(text, m.index, 25))) continue;
    out.push(hit('telefono', m.index, m.index + m[0].length, text, conf, ctx ? 'Teléfono (indicado en el texto)' : 'Formato de teléfono español'));
  }
  for (const m of text.matchAll(/(?<![\d\p{L}])(?:\+|00)(?!34)[1-9]\d{0,2}(?:[\s.-]?\(?\d{1,4}\)?){2,5}(?![\d]|[.,]\d)/gu)) {
    const n = m[0].replace(/\D/g, '').length;
    if (n >= 9 && n <= 15) out.push(hit('telefono', m.index, m.index + m[0].length, text, 0.9, 'Teléfono internacional'));
  }
}

const MONTHS = 'enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre';
function findBirthDates(text, out) {
  const ctx = /(nacimiento|nacid[oa]s?|f\.?\s?(?:de\s)?nac\.?|fec\.?\s?nac|naci[oó]|natalicio|d\.?o\.?b\.?|date of birth|born)\b[^\n]{0,30}$/i;
  const res = [
    /(?<!\d)(?:0?[1-9]|[12]\d|3[01])[/.-](?:0?[1-9]|1[0-2])[/.-](?:19|20)?\d{2}(?!\d)/g,
    /(?<!\d)(?:19|20)\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])(?!\d)/g,
    new RegExp(`(?<!\\d)(?:0?[1-9]|[12]\\d|3[01])\\s+de\\s+(?:${MONTHS})\\s+(?:de|del)\\s+(?:19|20)\\d{2}`, 'giu'),
  ];
  for (const re of res) for (const m of text.matchAll(re)) {
    if (ctx.test(before(text, m.index, 60))) out.push(hit('nacimiento', m.index, m.index + m[0].length, text, 0.95, 'Fecha precedida de "nacimiento"'));
  }
}

// ------------------------------------------------------------------ direcciones
// Tipos de vía: sin distinguir mayúsculas (en los contratos se escribe "calle"), pero el nombre de la vía sí debe
// empezar por mayúscula o número. JavaScript no permite mezclar ambas cosas en una expresión, así que las palabras
// clave se escriben aceptando las dos formas de cada letra.
const ci = w => w.replace(/\p{L}/gu, ch => ch.toLowerCase() === ch.toUpperCase() ? ch : '[' + ch.toLowerCase() + ch.toUpperCase() + ']');
const STREET = '(?:C\\s?\\/|C\\.\\/|' + ['calle', 'carrer', 'rúa', 'rua', 'kalea', 'avenida', 'avinguda', 'plaza', 'plaça', 'placa', 'paseo', 'passeig', 'camino', 'carretera', 'ronda', 'travesía', 'travesia', 'glorieta', 'urbanización', 'urbanizacion', 'pasaje', 'rambla', 'bulevar', 'callejón', 'callejon', 'cuesta', 'polígono', 'poligono', 'barrio', 'partida', 'lugar', 'diseminado'].map(ci).join('|') +
  String.raw`|Avda\.?|AVDA\.?|Av\.|AV\.|Pza\.?|PZA\.?|P[lIl1]\.|PL\.|P[º°]\.?|Pso\.|Cmno\.|Ctra\.?|CTRA\.?|Rda\.|Trav\.|Gta\.|Urb\.|URB\.|Psje\.|Blvr?\.|Pol\.\s?Ind\.?|B[º°])`;
const CP_CITY = String.raw`(?:C\.?\s?P\.?:?\s*)?(?:0[1-9]|[1-4]\d|5[0-2])\d{3}(?:[ \t,-]+(?:[\p{Lu}][\p{L}'’.-]*)(?:[ \t]+(?:de|del|la|las|los|el|d'|[\p{Lu}][\p{L}'’.-]*)){0,4})?(?:[ \t]*\((?:[\p{Lu}][\p{L} .-]{1,25})\))?`;
const ADDRESS_RE = new RegExp(
  String.raw`(?<![\p{L}])${STREET}[ \t]+(?:(?:de|del|de la|de los|de las|dels|d'|DE|DEL)[ \t]+)?[\p{Lu}\d][\p{L}\d'’ºª.\- \t]{1,55}?` +
  String.raw`(?:,?[ \t]*(?:[nN][º°o]\.?|[nN][uú]m\.?|[nN][uú]mero)?[ \t]*\d{1,4}(?:[ \t]?[A-Z](?![\p{L}]))?|,?[ \t]*[sS]\/[nN])` +
  String.raw`(?:[ \t]*[,-]?[ \t]*(?:\d{1,2}[ \t]?[º°ª][ \t]?[A-Za-z0-9]{0,2}(?![\p{L}])|(?:[pP]iso|[pP]lanta|[pP]uerta|[pP]ta\.?|[eE]sc\.?|[eE]scalera|[bB]loque|[bB]lq\.?|[pP]ortal|[bB]ajo|[aáAÁ]tico|[eE]ntresuelo|[eE]ntlo\.?|[lL]ocal|[kK]m\.?|izq(?:uierda)?\.?|dcha\.?|derecha|centro)(?:[ \t.]+[\p{L}\d]{1,3})?(?![\p{L}])))*` +
  String.raw`(?:[ \t]*[,-]?[ \t]*${CP_CITY})?`, 'gu');
const CP_ALONE_RE = new RegExp(String.raw`(?:^|(?<=[,\n]\s?)|(?<=C\.?\s?P\.?:?\s?))${CP_CITY}`, 'gmu');

function findAddresses(text, out) {
  for (const m of text.matchAll(ADDRESS_RE)) {
    let s = m[0].replace(/[\s,.-]+$/, '');
    out.push(hit('direccion', m.index, m.index + s.length, text, 0.9, 'Tipo de vía seguido de número'));
  }
  // "con domicilio en ...", "Domicilio: ..." hasta el final de la línea o hasta la siguiente parte de la frase.
  for (const m of text.matchAll(/(?:domicili(?:o|ad[oa])(?:\s+(?:social|fiscal|a efectos de notificaciones))?\s*(?:en|:)|direcci[oó]n\s*(?:postal)?\s*:|residente\s+en|vecin[oa]\s+de|con\s+residencia\s+en)[ \t]*(?:la\s+|el\s+)?/giu)) {
    const start = m.index + m[0].length;
    const rest = text.slice(start, start + 140);
    const stop = rest.search(/\n|;|,?\s*(?:y\s+)?(?:tel[eé]fono|tel\.|tfno|m[oó]vil|correo|e-?mail|fax)\b|\s(?:y\s+)?con\s+(?:D\.?N\.?I|N\.?I\.?[FE]|DNI|NIF|NIE|tel|correo|email|n[uú]mero)|,\s*(?:y\s+)?(?:provist[oa]|mayor|en\s+(?:su\s+)?(?:propio\s+)?nombre|actuando|en\s+adelante|que\s)|\.$/iu);
    let s = (stop < 0 ? rest : rest.slice(0, stop));
    const sentence = s.search(/[.;]\s+(?:El|La|Los|Las|Que|Y|En|Con|Ambas|Dicho|Dicha)\s/u);
    if (sentence >= 0) s = s.slice(0, sentence);
    s = s.replace(/[\s,.-]+$/, '');
    if (s.length >= 6 && /\d|[\p{Lu}]/u.test(s)) out.push(hit('direccion', start, start + s.length, text, 0.85, 'Texto tras "domicilio"/"dirección"'));
  }
  for (const m of text.matchAll(CP_ALONE_RE)) {
    const s = m[0].replace(/[\s,.-]+$/, '');
    if (/\d{5}[ \t,-]+[\p{Lu}]/u.test(s) && !/\d{5}[ \t]+(?:EUR|Euros?|Unidades|Uds)/i.test(s)) out.push(hit('direccion', m.index, m.index + s.length, text, 0.75, 'Código postal y población'));
  }
}

// ------------------------------------------------------------------ nombres
const PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'i', 'e', 'da', 'dos', 'das', 'van', 'von', 'der', 'di', 'st.']);
const HONORIFIC = /^(?:D\.?ª?|Dª|D\.ª|Dña\.?|Dñª|Don|Doña|Dn\.|Sr\.?|Sra\.?|Srta\.?|Sres\.?|Señor|Señora|Señorita|Dr\.?|Dra\.?|Excmo\.?|Excma\.?|Ilmo\.?|Ilma\.?|Mr\.?|Mrs\.?|Ms\.?)$/u;
const LABEL = /(?:^|[\s(,;])(?:nombre(?:\s+y\s+apellidos|\s+completo|\s+del\s+(?:trabajador|titular|cliente|empleado|paciente|alumno))?|apellidos(?:\s+y\s+nombre|,\s*nombre)?|trabajador(?:\/a|a)?|empleado(?:\/a)?|empleada|cliente|titular(?:\s+de\s+la\s+cuenta)?|arrendador(?:\/a|a)?|arrendatari[oa](?:\/a)?|inquilin[oa]|propietari[oa]|paciente|fdo\.?|firmado(?:\s+por)?|representante(?:\s+legal)?|representad[oa]\s+por|persona\s+de\s+contacto|contacto|destinatari[oa]|beneficiari[oa]|solicitante|interesad[oa]|comprador(?:a)?|vendedor(?:a)?|deudor(?:a)?|acreedor(?:a)?|avalista|fiador(?:a)?|c[oó]nyuge|padre|madre|tutor(?:a)?|alumn[oa]|testigo|otorgante|compareciente|a\s+la\s+atenci[oó]n\s+de|a\/a|att?n?\.?|atentamente|a\s+favor\s+de|abonado)\s*[:.-]?\s*$/iu;
const AFTER_NAME = /^\s*,\s*(?:con\s+(?:D\.?\s?N\.?\s?I|N\.?\s?I\.?\s?[FE]|DNI|NIF|NIE|pasaporte)|mayor\s+de\s+edad|provist[oa]|nacid[oa]|vecin[oa]|con\s+domicilio|de\s+nacionalidad|casad[oa]|solter[oa]|en\s+(?:su\s+)?(?:propio\s+)?nombre)/iu;

function tokenizeLine(line, offset) {
  const tokens = [];
  for (const m of line.matchAll(/[\p{L}][\p{L}\p{M}'’-]*\.?ª?|,/gu)) tokens.push({ t: m[0], start: offset + m.index, end: offset + m.index + m[0].length });
  return tokens;
}
const isCap = t => /^[\p{Lu}]/u.test(t) && !/^[\p{Lu}]\.?$/u.test(t);
const isInitial = t => /^[\p{Lu}]\.$/u.test(t);
const isAllCaps = t => /^[\p{Lu}\p{M}'’-]+\.?$/u.test(t) && /[\p{Lu}]{2}/u.test(t);
const bare = t => norm(t.replace(/[.,ª]+$/, ''));
const isFirst = t => FIRST_NAMES.has(bare(t));
const isSurname = t => SURNAMES.has(bare(t));
const isStop = t => NOT_NAME.has(bare(t));
const gapOk = (text, a, b) => /^[ \t]+$/.test(text.slice(a.end, b.start)) || /^[ \t]*,[ \t]*$/.test(text.slice(a.end, b.start));

// Desde el token i, recoge una secuencia de palabras con mayúscula (con "de", "del"... entre medias).
function captureName(text, tokens, i, { allowComma = true, max = 6, multiline = false } = {}) {
  const words = [];
  let j = i, commaUsed = false;
  const gap = multiline ? /^[ \t]*,?[ \t]*\n?[ \t]*$/ : /^[ \t]*,?[ \t]*$/;
  while (j < tokens.length && words.length < 12 && words.filter(w => !PARTICLES.has(w.t.toLowerCase())).length < max) {
    const tok = tokens[j];
    const between = j > i ? text.slice(tokens[j - 1].end, tok.start) : '';
    if (j > i && !gap.test(between)) break;
    // Solo se salta de línea si el nombre quedó cortado (una sola palabra antes del salto).
    if (between.includes('\n') && words.filter(w => !PARTICLES.has(w.t.toLowerCase())).length >= 2) break;
    if (tok.t === ',') {
      if (!allowComma || commaUsed || !words.length || !words.every(w => isAllCaps(w.t) || PARTICLES.has(w.t.toLowerCase()))) break;
      const next = tokens[j + 1];
      if (!next || !isCap(next.t) || !isFirst(next.t)) break;
      commaUsed = true; j++; continue;
    }
    if (PARTICLES.has(tok.t.toLowerCase()) && tok.t === tok.t.toLowerCase()) {
      const next = tokens[j + 1];
      const next2 = tokens[j + 2];
      if (words.length && next && (isCap(next.t) || (PARTICLES.has(next.t) && next2 && isCap(next2.t)))) { words.push(tok); j++; continue; }
      break;
    }
    if (isInitial(tok.t) && words.length && tokens[j + 1] && isCap(tokens[j + 1].t)) { words.push(tok); j++; continue; }
    if (!isCap(tok.t) || isStop(tok.t)) break;
    if (COMPANY_SUFFIX.test(text.slice(tok.start, tok.start + 12))) return null;
    words.push(tok); j++;
  }
  while (words.length && PARTICLES.has(words[words.length - 1].t.toLowerCase())) words.pop();
  if (!words.length) return null;
  const last = words[words.length - 1];
  const after = text.slice(last.end, last.end + 14);
  if (COMPANY_SUFFIX.test(after.replace(/^[\s,]+/, ''))) return null;
  return { words, next: j };
}

function findNames(text, out) {
  const tokens = tokenizeLine(text, 0);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.t === ',') continue;
    // 1) Tras tratamiento (D., Dña., Sr....) o tras una etiqueta (Trabajador:, Fdo.:...). El nombre puede seguir en la línea siguiente.
    if (HONORIFIC.test(tok.t) && tokens[i + 1] && /^[ \t]*\n?[ \t]*$/.test(text.slice(tok.end, tokens[i + 1].start)) && text.slice(tok.end, tokens[i + 1].start).length) {
      const c = captureName(text, tokens, i + 1, { multiline: true });
      if (c) { push(c, 0.95, 'Nombre tras tratamiento (' + tok.t + ')'); i = c.next - 1; continue; }
    }
    if (!isCap(tok.t)) continue;
    const label = before(text, tok.start, 60).split('\n').pop().match(LABEL);
    if (label) {
      const c = captureName(text, tokens, i, { multiline: /:\s*$/.test(label[0]) });
      const known = c && c.words.some(w => isFirst(w.t) || isSurname(w.t));
      // Sin dos puntos ("EL ARRENDADOR LA ARRENDATARIA") solo cuenta si hay un nombre o apellido conocido.
      if (c && (known || /[:]\s*$/.test(label[0]) || /^(?:fdo|firmado|d\.?|dña)/i.test(label[0].trim())) && !(c.words.length === 1 && isStop(c.words[0].t))) {
        push(c, known ? 0.93 : 0.8, 'Nombre tras una etiqueta'); i = c.next - 1; continue;
      }
    }
    const c = captureName(text, tokens, i);
    if (!c) continue;
    const w = c.words.filter(x => !PARTICLES.has(x.t.toLowerCase()));
    // 2) "GARCÍA LÓPEZ, MARÍA": apellidos en mayúsculas, coma y nombre de pila.
    const commaIdx = c.words.findIndex((x, k) => k > 0 && text.slice(c.words[k - 1].end, x.start).includes(','));
    if (commaIdx > 0 && c.words.slice(0, commaIdx).some(x => isSurname(x.t)) && isFirst(c.words[commaIdx].t)) { push(c, 0.92, 'Apellidos y nombre'); i = c.next - 1; continue; }
    // 3) Nombre de pila del diccionario seguido de apellidos.
    const fi = w.findIndex(x => isFirst(x.t));
    if (fi >= 0) {
      let k = fi; while (k + 1 < w.length && isFirst(w[k + 1].t) && !isSurname(w[k + 1].t)) k++;
      const rest = w.slice(k + 1);
      const known = rest.filter(x => isSurname(x.t)).length;
      const sub = { words: c.words.slice(c.words.indexOf(w[fi])), next: c.next };
      if (known >= 1 || rest.length >= 2) { push(sub, known >= 1 ? 0.88 : 0.72, known ? 'Nombre y apellido frecuentes' : 'Nombre seguido de dos palabras con mayúscula'); i = c.next - 1; continue; }
    }
    // 4) Dos o más palabras con mayúscula justo antes de ", con DNI", ", mayor de edad"...
    const lastW = c.words[c.words.length - 1];
    if (w.length >= 2 && AFTER_NAME.test(text.slice(lastW.end, lastW.end + 40))) { push(c, 0.85, 'Persona identificada por el contexto'); i = c.next - 1; continue; }
  }
  function push(c, conf, reason) {
    const s = c.words[0].start, e = c.words[c.words.length - 1].end;
    const value = text.slice(s, e).replace(/[.,]+$/, '');
    if (value.replace(/[^\p{L}]/gu, '').length < 3) return;
    out.push(hit('nombre', s, s + value.length, text, conf, reason));
  }
}

// ------------------------------------------------------------------ resolución
function resolve(found) {
  found.sort((a, b) => (PRIORITY[b.type] - PRIORITY[a.type]) || ((b.end - b.start) - (a.end - a.start)) || (b.confidence - a.confidence));
  const kept = [];
  for (const d of found) {
    let cur = { ...d };
    let drop = false;
    for (const k of kept) {
      if (cur.end <= k.start || cur.start >= k.end) continue;
      if (k.start <= cur.start && k.end >= cur.end) { drop = true; break; }
      // Solape parcial: se recorta la parte que ya cubre la detección más fiable.
      const left = k.start - cur.start, right = cur.end - k.end;
      if (left >= right) cur.end = k.start; else cur.start = k.end;
    }
    if (drop || cur.end <= cur.start) continue;
    kept.push(cur);
  }
  return kept.sort((a, b) => a.start - b.start);
}

function tidy(text, d) {
  while (d.end > d.start && /[\s,;:.(-]/.test(text[d.end - 1]) && !(text[d.end - 1] === '.' && /[\p{Lu}]\.$/u.test(text.slice(d.start, d.end)) && d.type !== 'direccion')) d.end--;
  while (d.start < d.end && /[\s,;:)]/.test(text[d.start])) d.start++;
  d.text = text.slice(d.start, d.end);
  return d;
}

export function detectPage(text, { ocr = false } = {}) {
  const found = [];
  findEmails(text, found);
  if (ocr) findEmailsOcr(text, found);
  findIban(text, found);
  findDni(text, found);
  findNss(text, found);
  findPhones(text, found);
  findBirthDates(text, found);
  findAddresses(text, found);
  findNames(text, found);
  return resolve(found).map(d => tidy(text, d)).filter(d => d.text.replace(/[^\p{L}\d]/gu, '').length >= 3);
}

// Documento completo: detecta en cada página y marca también las demás apariciones de los mismos datos.
export function detectDocument(pageTexts, ocrPages = []) {
  const pages = pageTexts.map((t, i) => detectPage(t, { ocr: !!ocrPages[i] }));
  const known = new Map();
  pages.flat().forEach(d => {
    if (!['nombre', 'dni', 'email', 'cuenta', 'telefono', 'nss'].includes(d.type)) return;
    const key = fold(d.text).replace(/\s+/g, ' ').trim();
    if (key.replace(/[^\p{L}\d]/gu, '').length < 5) return;
    if (d.type === 'nombre' && !/\s/.test(key)) return;
    if (!known.has(key)) known.set(key, d);
  });
  pageTexts.forEach((text, p) => {
    const hay = fold(text);
    const extra = [];
    for (const [key, d] of known) {
      const pattern = new RegExp('(?<![\\p{L}\\d])' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+') + '(?![\\p{L}\\d])', 'gu');
      for (const m of hay.matchAll(pattern)) {
        if (pages[p].some(x => !(m.index + m[0].length <= x.start || m.index >= x.end))) continue;
        extra.push({ type: d.type, start: m.index, end: m.index + m[0].length, text: text.slice(m.index, m.index + m[0].length), confidence: Math.min(d.confidence, 0.9), reason: 'Mismo dato que en otra parte del documento' });
      }
    }
    if (extra.length) pages[p] = pages[p].concat(extra).sort((a, b) => a.start - b.start);
  });
  return pages;
}

// Busca un texto libre (para "añadir a mano todas las apariciones de...").
export function findAll(text, query) {
  const q = fold(query).trim();
  if (q.length < 2) return [];
  const hay = fold(text);
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gu');
  return [...hay.matchAll(re)].map(m => ({ start: m.index, end: m.index + m[0].length, text: text.slice(m.index, m.index + m[0].length) }));
}
