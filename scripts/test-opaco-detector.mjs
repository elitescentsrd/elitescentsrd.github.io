// Pruebas del motor de detección de datos personales de Opaco (opaco/js/detector.js). Sin red ni navegador.
import assert from 'node:assert/strict';
import { detectPage, detectDocument, dniLetterOk, ibanOk, cccOk, nssOk, luhnOk, findAll } from '../opaco/js/detector.js';

const found = text => detectPage(text).map(d => d.type + ':' + d.text);
const has = (text, type, value) => assert(found(text).includes(type + ':' + value), 'No detecta ' + type + ' «' + value + '» en: ' + text + '\n→ ' + JSON.stringify(found(text)));
const hasNot = (text, value) => assert(!found(text).some(x => x.split(':').slice(1).join(':').includes(value)), 'Detecta por error «' + value + '» en: ' + text + '\n→ ' + JSON.stringify(found(text)));

// ---- validadores
assert(dniLetterOk('12345678', 'Z') && !dniLetterOk('12345678', 'A'));
assert(ibanOk('ES91 2100 0418 4502 0005 1332') && !ibanOk('ES91 2100 0418 4502 0005 1333'));
assert(cccOk('21000418450200051332') && !cccOk('21000418460200051332'));
assert(luhnOk('4539578763621486') && !luhnOk('4539578763621487'));
assert(nssOk('28', '12345678', String(Number('2812345678') % 97).padStart(2, '0')));

// ---- identificadores
has('DNI: 12345678Z', 'dni', '12345678Z');
has('con D.N.I. número 12.345.678-Z, mayor de edad', 'dni', '12.345.678-Z');
has('NIE X1234567L expedido en Madrid', 'dni', 'X1234567L');
hasNot('Referencia 12345678A del pedido', '12345678A'); // letra incorrecta y sin contexto: no es un DNI
has('IBAN: ES91 2100 0418 4502 0005 1332 BIC: CAIXESBBXXX', 'cuenta', 'ES91 2100 0418 4502 0005 1332');
has('Cuenta de abono ES9121000418450200051332.', 'cuenta', 'ES9121000418450200051332');
has('CCC 2100-0418-45-0200051332', 'cuenta', '2100-0418-45-0200051332');
has('Tel.: 612 345 678', 'telefono', '612 345 678');
has('Teléfono +34 915 123 456 (oficina)', 'telefono', '+34 915 123 456');
has('Móvil 612345678', 'telefono', '612345678');
has('llámame al 91 123 45 67', 'telefono', '91 123 45 67');
hasNot('Total: 912.345.678,00 €', '912.345.678');
hasNot('Factura nº 912345678', '912345678');
has('correo: maria.garcia+rrhh@empresa-ejemplo.es.', 'email', 'maria.garcia+rrhh@empresa-ejemplo.es');
const nss = '28' + '12345678' + String(Number('2812345678') % 97).padStart(2, '0');
has('Nº afiliación S.S.: ' + nss, 'nss', nss);
has('Fecha de nacimiento: 14/03/1985', 'nacimiento', '14/03/1985');
has('nacida el 3 de mayo de 1990 en Toledo', 'nacimiento', '3 de mayo de 1990');
hasNot('Fecha de emisión: 14/03/2024', '14/03/2024');

// ---- direcciones
has('Domicilio: C/ Mayor 15, 3º B, 28013 Madrid', 'direccion', 'C/ Mayor 15, 3º B, 28013 Madrid');
has('con domicilio en la calle de Alcalá número 45, 2º izquierda, de Madrid, y con DNI 12345678Z', 'direccion', 'calle de Alcalá número 45, 2º izquierda, de Madrid');
has('Avda. de la Constitución, 7 - 41001 Sevilla (Sevilla)', 'direccion', 'Avda. de la Constitución, 7 - 41001 Sevilla (Sevilla)');
has('Plaza España 3\n08001 Barcelona', 'direccion', '08001 Barcelona');

// ---- nombres
has('De una parte, D. Juan Pérez García, mayor de edad', 'nombre', 'Juan Pérez García');
has('Dña. María de los Ángeles Rodríguez de la Fuente, con DNI 12345678Z', 'nombre', 'María de los Ángeles Rodríguez de la Fuente');
has('Trabajador: GARCÍA LÓPEZ, MARÍA', 'nombre', 'GARCÍA LÓPEZ, MARÍA');
has('Fdo.: Iker Aldekoa Urkiola', 'nombre', 'Iker Aldekoa Urkiola');
has('La reunión con Carmen Navarro fue ayer', 'nombre', 'Carmen Navarro');
has('Firmado por Sr. Okonkwo', 'nombre', 'Okonkwo');
has('Wladimir Kowalski Nowak, con NIE X1234567L', 'nombre', 'Wladimir Kowalski Nowak');
hasNot('Construcciones Antonio García S.L., con CIF B12345678', 'Antonio García');
hasNot('CONTRATO DE ARRENDAMIENTO DE VIVIENDA', 'CONTRATO');
hasNot('Hospital Universitario San Juan de Dios', 'Juan');
hasNot('Real Decreto Legislativo 2/2015, texto refundido del Estatuto de los Trabajadores', 'Estatuto');

// ---- tolerancia a errores típicos del OCR (páginas escaneadas)
const ocr = detectPage('Dirección: PI. del Ayuntamiento 9, 6% 12\nalejandro.martin\nO correo-ejemplo.es\nCuenta: ESO3 2100 1234 5156 7890 1234\nno lo sé O quizás.', { ocr: true }).map(d => d.type + ':' + d.text);
for (const v of ['direccion:PI. del Ayuntamiento 9, 6% 12', 'email:alejandro.martin\nO correo-ejemplo.es', 'cuenta:ESO3 2100 1234 5156 7890 1234']) assert(ocr.includes(v), 'OCR: no detecta ' + v + ' → ' + JSON.stringify(ocr));
assert(!detectPage('alejandro.martin\nO correo-ejemplo.es').some(d => d.type === 'email'), 'La arroba mal leída solo se tolera en páginas escaneadas');
has('Le escribo en la calle Mayor 5 y le llamo', 'direccion', 'calle Mayor 5');

// ---- documento: propagación a otras páginas y búsqueda libre
const doc = detectDocument(['Trabajador: Nkechi Adeyemi Balogun', 'Firma de Nkechi Adeyemi Balogun conforme']);
assert(doc[1].some(d => d.type === 'nombre' && d.text === 'Nkechi Adeyemi Balogun'), 'Propaga el nombre a otras páginas');
assert.deepEqual(findAll('Ref. ÁLAMO y álamo', 'alamo').map(m => m.text), ['ÁLAMO', 'álamo']);

console.log('Pruebas del detector de Opaco superadas.');
