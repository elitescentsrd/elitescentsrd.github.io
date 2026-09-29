// Genera los PDF de ejemplo de Opaco (opaco/ejemplos/): una nómina, un contrato de arrendamiento y una factura.
// Todas las personas, documentos y cuentas son ficticios; los identificadores tienen formato y dígitos de control
// válidos para que el detector los trate como reales. Uso: node scripts/opaco-generar-ejemplos.mjs
import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from '../opaco/vendor/pdf-lib.esm.min.js';

const dni = n => n + 'TRWAGMYFPDXBNJZSQVHLCKE'[Number(n) % 23];
const nie = (p, n) => p + n + 'TRWAGMYFPDXBNJZSQVHLCKE'[Number('XYZ'.indexOf(p) + n) % 23];
function iban(ccc) {
  const num = ccc + '142800'; // "ES" = 14 28, "00"
  let m = 0; for (const d of num) m = (m * 10 + Number(d)) % 97;
  const check = String(98 - m).padStart(2, '0');
  return ('ES' + check + ccc).replace(/(.{4})/g, '$1 ').trim();
}
function ccc(entidad, oficina, cuenta) {
  const w = [1, 2, 4, 8, 5, 10, 9, 7, 3, 6];
  const dc = ten => { let s = 0; for (let i = 0; i < 10; i++) s += Number(ten[i]) * w[i]; const d = 11 - (s % 11); return d === 11 ? 0 : d === 10 ? 1 : d; };
  return entidad + oficina + dc('00' + entidad + oficina) + dc(cuenta) + cuenta;
}
const nss = (prov, num) => prov + '/' + num + '/' + String(Number(prov + num) % 97).padStart(2, '0');

const INK = rgb(0.1, 0.12, 0.16), MUTED = rgb(0.38, 0.42, 0.48), LINE = rgb(0.8, 0.82, 0.86), FILL = rgb(0.95, 0.96, 0.97);

async function makeDoc(title) {
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setAuthor('Opaco (documento de ejemplo ficticio)'); doc.setCreator('Opaco');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  return { doc, font, bold };
}
function page(ctx) {
  const p = ctx.doc.addPage([595.28, 841.89]);
  const api = {
    p, y: 790,
    text(str, x, y, { size = 9.5, f = ctx.font, color = INK } = {}) { p.drawText(str, { x, y, size, font: f, color }); },
    wrap(str, x, width, { size = 10, f = ctx.font, lead = 14.5, color = INK } = {}) {
      const words = str.split(' '); let line = '';
      for (const w of words) {
        const t = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(t, size) > width) { api.text(line, x, api.y, { size, f, color }); api.y -= lead; line = w; } else line = t;
      }
      if (line) { api.text(line, x, api.y, { size, f, color }); api.y -= lead; }
    },
    box(x, y, w, h, fill) { p.drawRectangle({ x, y, width: w, height: h, borderColor: LINE, borderWidth: 0.8, color: fill }); },
    rule(y) { p.drawLine({ start: { x: 50, y }, end: { x: 545, y }, thickness: 0.8, color: LINE }); },
  };
  return api;
}
const footer = (pg, ctx, n, total) => pg.text('Documento de ejemplo ficticio generado por Opaco · Página ' + n + ' de ' + total, 50, 30, { size: 7.5, color: MUTED, f: ctx.font });

// ---------------------------------------------------------------- nómina
async function nomina() {
  const ctx = await makeDoc('Nómina ejemplo');
  const pg = page(ctx);
  const b = ctx.bold;
  pg.text('RECIBO INDIVIDUAL JUSTIFICATIVO DEL PAGO DE SALARIOS', 50, 800, { size: 12, f: b });
  pg.box(50, 690, 240, 95); pg.box(305, 690, 240, 95);
  pg.text('EMPRESA', 58, 772, { size: 8, f: b, color: MUTED });
  pg.text('Asesoría Ejemplo Norte S.L.', 58, 757, { f: b });
  pg.text('C/ Gran Vía 28, 4º, 48001 Bilbao (Bizkaia)', 58, 743);
  pg.text('CIF: B95123456', 58, 729);
  pg.text('C.C.C.: 48/1234567/12', 58, 715);
  pg.text('TRABAJADOR/A', 313, 772, { size: 8, f: b, color: MUTED });
  pg.text('Trabajador: GARCÍA LÓPEZ, MARÍA', 313, 757, { f: b });
  pg.text('NIF: ' + dni('45128763'), 313, 743);
  pg.text('Nº afiliación S.S.: ' + nss('48', '10293847'), 313, 729);
  pg.text('Domicilio: Calle Ercilla 12, 2º D, 48009 Bilbao', 313, 715);
  pg.text('Categoría: Técnica administrativa · Grupo cotización 5', 313, 701, { size: 8.5 });
  pg.text('Periodo de liquidación: del 01/09/2026 al 30/09/2026 · Días: 30 · Antigüedad: 15/02/2019', 50, 670, { size: 9 });
  let y = 640;
  pg.box(50, y - 4, 495, 18, FILL);
  pg.text('CONCEPTO', 58, y, { size: 8, f: b }); pg.text('DEVENGOS', 380, y, { size: 8, f: b }); pg.text('DEDUCCIONES', 470, y, { size: 8, f: b });
  const rows = [['Salario base', '1.620,00', ''], ['Complemento de puesto', '240,00', ''], ['Plus transporte', '85,00', ''], ['Prorrata pagas extra', '310,00', ''],
    ['Contingencias comunes 4,70 %', '', '105,99'], ['Desempleo 1,55 %', '', '34,95'], ['Formación profesional 0,10 %', '', '2,26'], ['MEI 0,13 %', '', '2,93'], ['Retención IRPF 12,00 %', '', '270,60']];
  for (const [c, d, e] of rows) { y -= 18; pg.text(c, 58, y); if (d) pg.text(d, 380, y); if (e) pg.text(e, 470, y); }
  y -= 12; pg.rule(y); y -= 18;
  pg.text('TOTAL DEVENGADO: 2.255,00 €', 58, y, { f: b }); pg.text('TOTAL A DEDUCIR: 416,73 €', 330, y, { f: b });
  y -= 22; pg.text('LÍQUIDO TOTAL A PERCIBIR: 1.838,27 €', 58, y, { size: 11, f: b });
  y -= 30; pg.text('Transferencia a la cuenta IBAN ' + iban(ccc('2095', '0611', '9876543210')) + ' (Kutxabank)', 58, y);
  y -= 16; pg.text('Contacto de la trabajadora para incidencias: maria.garcia.lopez@correo-ejemplo.es · Tel. 688 123 456', 58, y, { size: 9 });
  y -= 40; pg.text('Bilbao, a 30 de septiembre de 2026', 58, y);
  y -= 50; pg.text('Firma y sello de la empresa', 90, y, { size: 8.5, color: MUTED }); pg.text('Recibí: la trabajadora', 380, y, { size: 8.5, color: MUTED });
  footer(pg, ctx, 1, 1);
  return ctx.doc.save();
}

// ---------------------------------------------------------------- contrato
async function contrato() {
  const ctx = await makeDoc('Contrato de arrendamiento ejemplo');
  const b = ctx.bold;
  const pg = page(ctx);
  pg.text('CONTRATO DE ARRENDAMIENTO DE VIVIENDA', 50, 800, { size: 13, f: b });
  pg.y = 770; pg.wrap('En Valencia, a 1 de septiembre de 2026.', 50, 495);
  pg.y -= 8; pg.text('REUNIDOS', 50, pg.y, { f: b, size: 11 }); pg.y -= 20;
  pg.wrap('De una parte, D. Juan Pérez Sánchez, mayor de edad, con DNI ' + dni('21456789') + ', nacido el 12/04/1971, con domicilio en la calle de Colón número 18, 5º A, 46004 Valencia, teléfono 963 51 24 70 y correo electrónico jperez.sanchez@correo-ejemplo.es, en adelante EL ARRENDADOR.', 50, 495);
  pg.y -= 6;
  pg.wrap('De otra parte, Dña. Lucía Fernández Ortega, mayor de edad, con NIE ' + nie('Y', '3456781') + ', fecha de nacimiento 23 de julio de 1994, con domicilio a efectos de notificaciones en Avda. del Puerto 204, 3º 9, 46023 Valencia, móvil +34 655 908 172, en adelante LA ARRENDATARIA.', 50, 495);
  pg.y -= 6;
  pg.wrap('Ambas partes se reconocen capacidad legal suficiente para otorgar el presente contrato y, a tal efecto,', 50, 495);
  pg.y -= 8; pg.text('EXPONEN', 50, pg.y, { f: b, size: 11 }); pg.y -= 20;
  pg.wrap('I. Que EL ARRENDADOR es propietario de la vivienda situada en Calle Sueca 41, 2º 4, 46006 Valencia, con referencia catastral 5821604YJ2752B0004XT, libre de cargas y al corriente de pago de los gastos de comunidad.', 50, 495);
  pg.y -= 4;
  pg.wrap('II. Que LA ARRENDATARIA está interesada en arrendar dicha vivienda para destinarla a su residencia habitual y permanente, por lo que ambas partes acuerdan formalizar el presente contrato de arrendamiento conforme a las siguientes', 50, 495);
  pg.y -= 8; pg.text('CLÁUSULAS', 50, pg.y, { f: b, size: 11 }); pg.y -= 20;
  const clausulas = [
    'PRIMERA. Objeto. EL ARRENDADOR arrienda a LA ARRENDATARIA la vivienda descrita en el expositivo I, que esta acepta en el estado de conservación en que se encuentra y que declara conocer.',
    'SEGUNDA. Duración. El contrato tendrá una duración de un año a contar desde la fecha de su firma, prorrogable en los términos previstos en la Ley 29/1994, de Arrendamientos Urbanos.',
    'TERCERA. Renta. La renta anual se fija en 11.400 euros, pagaderos en mensualidades de 950 euros dentro de los cinco primeros días de cada mes mediante transferencia a la cuenta del arrendador IBAN ' + iban(ccc('0081', '0216', '7300012345')) + '.',
  ];
  for (const c of clausulas) { pg.wrap(c, 50, 495); pg.y -= 6; }
  footer(pg, ctx, 1, 2);
  const pg2 = page(ctx);
  pg2.y = 790;
  const mas = [
    'CUARTA. Fianza. En este acto LA ARRENDATARIA entrega la cantidad de 950 euros en concepto de fianza legal, que será depositada en el organismo autonómico competente.',
    'QUINTA. Gastos. Los suministros de agua, electricidad y gas, que se contratarán a nombre de LA ARRENDATARIA, serán de su cuenta. Los gastos de comunidad y el Impuesto sobre Bienes Inmuebles corresponden al arrendador.',
    'SEXTA. Notificaciones. Las partes designan como medio preferente de comunicación los correos electrónicos indicados en el encabezamiento. Para cualquier incidencia urgente LA ARRENDATARIA podrá llamar a D. Juan Pérez Sánchez al teléfono 963 51 24 70.',
    'SÉPTIMA. Protección de datos. Los datos personales de las partes se tratarán únicamente para la gestión del presente contrato, conforme al Reglamento (UE) 2016/679.',
  ];
  for (const c of mas) { pg2.wrap(c, 50, 495); pg2.y -= 6; }
  pg2.y -= 10; pg2.wrap('Y en prueba de conformidad, firman el presente contrato por duplicado en el lugar y fecha indicados.', 50, 495);
  pg2.y -= 60;
  pg2.text('EL ARRENDADOR', 70, pg2.y, { f: b, size: 9 }); pg2.text('LA ARRENDATARIA', 350, pg2.y, { f: b, size: 9 });
  pg2.y -= 50;
  pg2.text('Fdo.: Juan Pérez Sánchez', 70, pg2.y); pg2.text('Fdo.: Lucía Fernández Ortega', 350, pg2.y);
  footer(pg2, ctx, 2, 2);
  return ctx.doc.save();
}

// ---------------------------------------------------------------- factura
async function factura() {
  const ctx = await makeDoc('Factura ejemplo');
  const b = ctx.bold;
  const pg = page(ctx);
  pg.text('Reformas Levante Hogar S.L.', 50, 800, { size: 14, f: b });
  pg.text('CIF B46123457 · Carrer de la Pau 7, 46002 Valencia · administracion@reformas-levante-ejemplo.es', 50, 784, { size: 8.5, color: MUTED });
  pg.text('FACTURA', 440, 800, { size: 16, f: b });
  pg.text('Nº 2026-0417', 440, 784, { size: 9 });
  pg.text('Fecha: 18/09/2026', 440, 771, { size: 9 });
  pg.box(50, 660, 300, 95);
  pg.text('FACTURAR A', 58, 742, { size: 8, f: b, color: MUTED });
  pg.text('Cliente: Alejandro Martín Ruiz', 58, 727, { f: b });
  pg.text('NIF: ' + dni('53987214'), 58, 713);
  pg.text('Dirección: Pl. del Ayuntamiento 9, 6º 12', 58, 699);
  pg.text('46002 Valencia', 58, 685);
  pg.text('Tel. 622 47 15 90 · alejandro.martin@correo-ejemplo.es', 58, 671, { size: 9 });
  let y = 620;
  pg.box(50, y - 5, 495, 18, FILL);
  pg.text('DESCRIPCIÓN', 58, y, { size: 8, f: b }); pg.text('UDS.', 330, y, { size: 8, f: b }); pg.text('PRECIO', 390, y, { size: 8, f: b }); pg.text('IMPORTE', 480, y, { size: 8, f: b });
  const rows = [['Reforma de baño completo (mano de obra)', '1', '2.150,00', '2.150,00'], ['Plato de ducha extraplano 120x80', '1', '289,00', '289,00'], ['Mampara de vidrio templado', '1', '335,00', '335,00'], ['Grifería termostática', '1', '164,00', '164,00'], ['Retirada de escombros', '1', '120,00', '120,00']];
  for (const r of rows) { y -= 20; pg.text(r[0], 58, y); pg.text(r[1], 336, y); pg.text(r[2], 390, y); pg.text(r[3], 480, y); }
  y -= 14; pg.rule(y);
  y -= 20; pg.text('Base imponible', 380, y); pg.text('3.058,00 €', 475, y);
  y -= 16; pg.text('IVA 21 %', 380, y); pg.text('642,18 €', 475, y);
  y -= 18; pg.text('TOTAL', 380, y, { f: b, size: 11 }); pg.text('3.700,18 €', 475, y, { f: b, size: 11 });
  y -= 50; pg.text('Forma de pago: transferencia bancaria a 30 días.', 58, y);
  y -= 15; pg.text('Cuenta de la empresa: ' + iban(ccc('2100', '1234', '5678901234')), 58, y);
  y -= 15; pg.text('Recibo domiciliado del cliente en la cuenta ' + iban(ccc('0182', '4572', '0201587436')), 58, y);
  footer(pg, ctx, 1, 1);
  return ctx.doc.save();
}

await writeFile('opaco/ejemplos/nomina-ejemplo.pdf', await nomina());
await writeFile('opaco/ejemplos/contrato-ejemplo.pdf', await contrato());
await writeFile('opaco/ejemplos/factura-ejemplo.pdf', await factura());
console.log('Ejemplos generados en opaco/ejemplos/.');
