'use strict';
// Cálculos del panel (sin pantalla, para poder probarlos): cuentas por cobrar y abonos, precio sugerido con la fórmula
// de ganancia, ganancia real por pedido y por mes, lista de compra para el suplidor y archivos CSV para Excel.
// Los costos y los parámetros de la fórmula NO están aquí: vienen de la base de datos (solo administradores).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.EliteFinanzas = api;
})(typeof self !== 'undefined' ? self : this, function () {
  // Pedidos que cuentan como venta (igual que el resumen de ventas) y pedidos que todavía hay que comprar/entregar.
  const SOLD = ['confirmado', 'preparando', 'enviado', 'entregado'];
  const PENDING = ['nuevo', 'confirmado', 'preparando'];
  const norm = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const statusOf = order => norm(order.status) || 'nuevo';
  const amounts = value => (String(value || '').match(/[0-9][0-9,]*(?:\.[0-9]+)?/g) || []).map(v => Number(v.replace(/,/g, ''))).filter(n => Number.isFinite(n) && n > 0);
  const amountOf = order => amounts(order.amount)[0] || 0;
  const money = n => 'RD$' + Math.round(Number(n) || 0).toLocaleString('en-US');
  const round2 = n => Math.round(n * 100) / 100;

  // ---------------------------------------------------------------- Cuentas por cobrar
  // Saldo de cada pedido vendido: total del pedido menos la suma de sus abonos.
  function balances(orders, payments) {
    const paidBy = new Map(), lastBy = new Map();
    for (const p of payments || []) {
      const id = String(p.order_id);
      paidBy.set(id, (paidBy.get(id) || 0) + (Number(p.amount) || 0));
      const when = String(p.paid_on || p.created_at || '');
      if (!lastBy.has(id) || when > lastBy.get(id)) lastBy.set(id, when);
    }
    const rows = (orders || []).filter(o => SOLD.includes(statusOf(o))).map(o => {
      const total = amountOf(o), paid = round2(paidBy.get(String(o.id)) || 0), due = round2(Math.max(total - paid, 0));
      return { order: o, total, paid, due, last: lastBy.get(String(o.id)) || null, state: !total ? 'sin total' : due <= 0 ? 'pagado' : paid > 0 ? 'abonado' : 'pendiente' };
    });
    const open = rows.filter(r => r.due > 0 && r.total > 0);
    const customers = new Set(open.map(r => norm(r.order.phone) || norm(r.order.customer_name)));
    return {
      rows: rows.sort((a, b) => (b.due - a.due) || String(a.order.created_at).localeCompare(String(b.order.created_at))),
      totals: { due: round2(open.reduce((s, r) => s + r.due, 0)), paid: round2(rows.reduce((s, r) => s + r.paid, 0)), open: open.length, customers: customers.size },
    };
  }
  // Abonos recibidos en un rango de fechas (para el resumen de ventas).
  function collected(payments, from, to) {
    return round2((payments || []).filter(p => {
      const t = Date.parse(p.paid_on || p.created_at);
      return !Number.isNaN(t) && (!from || t >= from.getTime()) && (!to || t < to.getTime());
    }).reduce((s, p) => s + (Number(p.amount) || 0), 0));
  }
  // Número de WhatsApp: un número dominicano de 10 dígitos lleva el 1 del país delante.
  function waNumber(phone) {
    let digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 10) digits = '1' + digits;
    return digits;
  }
  const waLink = (phone, text) => 'https://wa.me/' + waNumber(phone) + '?text=' + encodeURIComponent(text);
  function reminderText(row) {
    const o = row.order, first = String(o.customer_name || '').trim().split(/\s+/)[0] || '';
    return 'Hola' + (first ? ' ' + first : '') + ', te saluda Elite Scents RD. Te comparto el balance de tu pedido #' + o.id +
      (o.items ? ' (' + String(o.items).split(/\r?\n/).map(s => s.trim()).filter(Boolean).join(', ') + ')' : '') + ':\n' +
      'Total: ' + money(row.total) + '\nAbonado: ' + money(row.paid) + '\nPendiente: ' + money(row.due) +
      '\n\nCuando puedas, me confirmas por aquí tu próximo pago. ¡Gracias por tu compra!';
  }
  const restockText = (name, product) => 'Hola' + (name ? ' ' + String(name).trim().split(/\s+/)[0] : '') + ', te escribe Elite Scents RD: ya tenemos ' +
    product.name + (product.size ? ' (' + product.size + ')' : '') + (product.price ? ' a ' + product.price : '') + '. ¿Te lo apartamos? ' +
    'https://elitescentsrd.github.io/#producto-' + product.id;

  // ---------------------------------------------------------------- Precio sugerido con la fórmula
  // params (se guardan en la base de datos): { logistica, ganancia_minima, curva: [[costo_total, margen], ...],
  //   estrategias: { gancho: { factor, descuento }, normal: {...}, exclusivo: {...} } }
  // precio justo = (costo + logística) × (1 + margen de la curva × factor de la estrategia)
  // tope         = precio de la competencia × (1 − descuento de la estrategia)
  // piso         = costo + logística + ganancia mínima
  // sugerido     = el mayor entre el piso y el menor entre justo y tope, terminado en 50 (sin bajar del piso).
  function validParams(params) {
    const p = params || {};
    const curva = Array.isArray(p.curva) ? p.curva.filter(x => Array.isArray(x) && x.length === 2 && x.every(Number.isFinite)).sort((a, b) => a[0] - b[0]) : [];
    const ok = Number.isFinite(p.logistica) && Number.isFinite(p.ganancia_minima) && curva.length >= 1 &&
      ['gancho', 'normal', 'exclusivo'].every(k => p.estrategias && Number.isFinite(p.estrategias[k]?.factor) && Number.isFinite(p.estrategias[k]?.descuento));
    return ok ? { logistica: p.logistica, ganancia_minima: p.ganancia_minima, curva, estrategias: p.estrategias } : null;
  }
  function marginAt(curva, total) {
    if (total <= curva[0][0]) return curva[0][1];
    for (let i = 1; i < curva.length; i++) {
      const [x0, y0] = curva[i - 1], [x1, y1] = curva[i];
      if (total <= x1) return y0 + ((total - x0) / (x1 - x0)) * (y1 - y0);
    }
    return curva[curva.length - 1][1];
  }
  function suggestPrice(cost, strategy, params, competitor) {
    const p = validParams(params), c = Number(cost);
    if (!p || !(c > 0)) return null;
    const st = p.estrategias[strategy] || p.estrategias.normal;
    const total = c + p.logistica, justo = total * (1 + marginAt(p.curva, total) * st.factor);
    const tope = Number(competitor) > 0 ? Number(competitor) * (1 - st.descuento) : Infinity;
    const piso = total + p.ganancia_minima;
    // Se redondea primero a centavos: 10,000 × 1.36 da 13,599.999… en la computadora y debe contar como 13,600.
    const target = Math.round(Math.max(piso, Math.min(justo, tope)) * 100) / 100;
    let price = Math.round((target - 50) / 100) * 100 + 50;
    while (price < piso) price += 100;
    return { price, profit: Math.round(price - total), margin: price / total - 1, floor: piso, fair: Math.round(justo), cap: Number.isFinite(tope) ? Math.round(tope) : null };
  }
  // Varias presentaciones ("RD$2,850 / RD$3,600"): un sugerido por costo, en el mismo formato del precio.
  function suggestText(costs, strategy, params, competitor) {
    const list = (costs || []).map((c, i) => suggestPrice(c, strategy, params, i === 0 ? competitor : null));
    return list.length && list.every(Boolean) ? { text: list.map(s => money(s.price)).join(' / '), items: list } : null;
  }
  // Revisa el precio normal de hoy con las mismas reglas con que se pusieron los precios:
  //  - una diferencia de RD$50 o menos no cuenta («mantener», como en el análisis de precios);
  //  - con precio de la competencia, un precio entre el sugerido y el de la competencia ya está «a nivel de la competencia»;
  //  - un perfume de menos de RD$7,000 que no está «Solo por encargo» no se sugiere en RD$7,000 o más (la tienda lo
  //    pasaría sola a «Solo por encargo»): se sugiere RD$6,950, salvo que eso deje menos de la ganancia mínima.
  // text = el precio a aplicar: solo cambian las presentaciones que lo necesitan.
  const TOLERANCIA = 50, ENCARGO_DESDE = 7000, TOPE_DISPONIBLE = 6950;
  function reviewPrice(product, costs, strategy, params, competitor) {
    const s = suggestText(costs, strategy, params, competitor);
    if (!s) return null;
    const current = amounts(product.original_price || product.price), comp = Number(competitor) > 0 ? Number(competitor) : null;
    // Un costo por presentación: si no coinciden, no se sugiere cambiar (se perdería una presentación del precio).
    if (current.length && current.length !== s.items.length) return { suggestion: s, items: [], differs: false, mismatch: true, text: current.map(money).join(' / ') };
    const keepAvailable = product.availability !== 'encargo' && current.length > 0 && Math.max(...current) < ENCARGO_DESDE;
    const items = s.items.map((it, i) => {
      const capped = keepAvailable && it.price >= ENCARGO_DESDE && TOPE_DISPONIBLE >= it.floor, target = capped ? TOPE_DISPONIBLE : it.price, c = current[i];
      let state = c > 0 ? (c > target ? 'alto' : 'bajo') : 'nuevo';
      if (c > 0 && c < it.floor) state = 'bajo-piso';
      else if (c > 0 && Math.abs(c - target) <= TOLERANCIA) state = 'igual';
      else if (c > 0 && i === 0 && comp && c > target && c <= comp) state = 'mercado';
      return { ...it, target, capped, current: c || null, state, profitTarget: Math.round(it.profit + target - it.price) };
    });
    const keep = x => x.state === 'igual' || x.state === 'mercado';
    return { suggestion: s, items, differs: items.some(x => !keep(x)), mismatch: false, text: items.map(x => money(keep(x) ? x.current : x.target)).join(' / ') };
  }
  function currentProfit(product, costs, params) {
    const prices = amounts(product.original_price || product.price), p = validParams(params), extra = p ? p.logistica : 0;
    if (!prices.length || !(costs || []).length) return null;
    return prices.map((price, i) => { const c = costs[Math.min(i, costs.length - 1)]; return { price, profit: Math.round(price - c - extra), margin: price / (c + extra) - 1 }; });
  }

  // ---------------------------------------------------------------- Líneas de los pedidos ("2x Nombre (100 ML)")
  function parseLines(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n|;/)) {
      let line = raw.trim();
      if (!line) continue;
      let qty = 1;
      const lead = line.match(/^(\d{1,2})\s*[x×*]\s*(.+)$/i);
      if (lead) { qty = Number(lead[1]) || 1; line = lead[2]; } else line = line.replace(/^[-•·]\s*/, '');
      const size = (line.match(/\(([^)]*)\)\s*$/) || [])[1] || '';
      line = line.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (line) out.push({ name: line, qty: Math.min(qty, 99), size: size.trim() });
    }
    return out;
  }
  function productIndex(products) {
    const byName = new Map();
    for (const p of products || []) byName.set(norm(p.name), p);
    return byName;
  }
  // Presentación de la línea: por el tamaño escrito (p. ej. "50 ML") o la primera.
  function sizeIndex(product, size) {
    const sizes = String(product.size || '').split('/').map(norm);
    const i = size ? sizes.indexOf(norm(size)) : -1;
    return i >= 0 ? i : 0;
  }

  // ---------------------------------------------------------------- Ganancia real (pedidos vendidos con costo conocido)
  function orderProfit(order, byName, costsById, params) {
    const p = validParams(params), extra = p ? p.logistica : 0, lines = parseLines(order.items);
    let cost = 0, known = lines.length > 0;
    for (const line of lines) {
      const product = byName.get(norm(line.name)), c = product && costsById.get(Number(product.id));
      if (!c || !c.length) { known = false; continue; }
      cost += line.qty * (c[Math.min(sizeIndex(product, line.size), c.length - 1)] + extra);
    }
    const sale = amountOf(order);
    return { sale, cost: Math.round(cost), profit: known ? Math.round(sale - cost) : null, known };
  }
  function profitSummary(orders, products, costsById, params, options = {}) {
    const byName = productIndex(products), months = options.months || 6, now = options.now || new Date();
    const keyOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const table = new Map();
    for (let i = months - 1; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); table.set(keyOf(d), { month: keyOf(d), sales: 0, cost: 0, profit: 0, orders: 0, unknown: 0 }); }
    const perOrder = new Map();
    for (const o of orders || []) {
      if (!SOLD.includes(statusOf(o))) continue;
      const r = orderProfit(o, byName, costsById, params); perOrder.set(String(o.id), r);
      const t = Date.parse(o.created_at); if (Number.isNaN(t)) continue;
      const row = table.get(keyOf(new Date(t))); if (!row) continue;
      if (r.known) { row.sales += r.sale; row.cost += r.cost; row.profit += r.profit; row.orders += 1; } else row.unknown += 1;
    }
    return { months: [...table.values()], perOrder };
  }

  // ---------------------------------------------------------------- Lista de compra para el suplidor
  // Suma lo que falta entregar (pedidos nuevos, confirmados y en preparación) y, aparte, cuánta gente espera cada agotado.
  function purchaseList(orders, products, alerts, options = {}) {
    const byName = productIndex(products), map = new Map(), unmatched = [];
    for (const o of orders || []) {
      if (!PENDING.includes(statusOf(o))) continue;
      for (const line of parseLines(o.items)) {
        const product = byName.get(norm(line.name));
        if (!product) { unmatched.push({ order: o.id, text: line.qty + 'x ' + line.name + (line.size ? ' (' + line.size + ')' : '') }); continue; }
        if (!options.includeAvailable && product.availability === 'disponible') continue;
        const size = String(product.size || '').split('/').map(s => s.trim())[sizeIndex(product, line.size)] || product.size || '';
        const key = product.id + '|' + norm(size);
        const e = map.get(key) || { product, size, qty: 0, orders: [], waiting: 0 };
        e.qty += line.qty; if (!e.orders.includes(o.id)) e.orders.push(o.id); map.set(key, e);
      }
    }
    const waitingBy = new Map();
    for (const a of alerts || []) if ((a.status || 'pendiente') === 'pendiente') waitingBy.set(Number(a.product_id), (waitingBy.get(Number(a.product_id)) || 0) + 1);
    for (const e of map.values()) e.waiting = waitingBy.get(Number(e.product.id)) || 0;
    const waiting = [];
    if (options.includeWaiting !== false) {
      const byId = new Map((products || []).map(p => [Number(p.id), p]));
      for (const [id, count] of waitingBy) {
        const product = byId.get(id);
        // Un perfume que ya está disponible no se compra por los avisos: hay que avisar a esas personas (sección «Avísame»).
        if (!product || [...map.values()].some(e => Number(e.product.id) === id) || (product.availability === 'disponible' && !options.includeAvailable)) continue;
        waiting.push({ product, size: String(product.size || '').split('/')[0].trim(), qty: 0, orders: [], waiting: count });
      }
    }
    const rows = [...map.values(), ...waiting].sort((a, b) => (b.qty - a.qty) || (b.waiting - a.waiting) || a.product.name.localeCompare(b.product.name, 'es'));
    return { rows, unmatched };
  }
  function purchaseText(rows, supplier = 'La Grada') {
    const lines = rows.filter(r => r.buy > 0).map(r => r.buy + 'x ' + r.product.name + (r.size ? ' (' + r.size + ')' : ''));
    return 'Hola ' + supplier + ', te escribe Elite Scents RD. Quiero hacer este pedido:\n\n' + lines.join('\n') + '\n\n¿Me confirmas disponibilidad y el total? ¡Gracias!';
  }

  // ---------------------------------------------------------------- CSV para Excel
  const csvCell = v => { const s = String(v ?? ''); return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  function splitCsvLine(line, sep) {
    const out = []; let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
      else if (ch === '"') quoted = true; else if (ch === sep) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur); return out.map(s => s.trim());
  }
  const STRATEGIES = { gancho: 'gancho', normal: 'normal', exclusivo: 'exclusivo' };
  function costsCsv(products, costsById, strategyById, competitorById) {
    const rows = [['id', 'perfume', 'tamaño', 'precio', 'costo', 'estrategia', 'competencia']];
    for (const p of products) {
      const c = costsById.get(Number(p.id)) || [];
      rows.push([p.id, p.name, p.size || '', p.original_price || p.price || '', c.join(' / '), strategyById.get(Number(p.id)) || 'normal', competitorById.get(Number(p.id)) || '']);
    }
    return toCsv(rows);
  }
  // Lee la lista de costos (la que se descarga del panel o una del suplidor): id o nombre del perfume, costo y, si hay,
  // estrategia y precio de la competencia. Devuelve lo que se puede guardar y lo que no se reconoció.
  function parseCostsCsv(text, products) {
    const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (!lines.length) return { rows: [], errors: ['El archivo está vacío.'] };
    const sep = (lines[0].match(/;/g) || []).length > (lines[0].match(/,/g) || []).length ? ';' : ',';
    const header = splitCsvLine(lines[0], sep).map(norm);
    const col = names => header.findIndex(h => names.some(n => h === n || h.startsWith(n)));
    const iId = col(['id']), iName = col(['perfume', 'nombre', 'producto']), iCost = col(['costo', 'cost']), iStrategy = col(['estrategia']), iComp = col(['competencia']);
    if (iCost < 0 || (iId < 0 && iName < 0)) return { rows: [], errors: ['La primera fila debe tener las columnas «id» o «perfume» y «costo».'] };
    const byId = new Map((products || []).map(p => [Number(p.id), p])), byName = productIndex(products);
    const rows = [], errors = [];
    lines.slice(1).forEach((line, n) => {
      const cells = splitCsvLine(line, sep), fila = n + 2;
      const product = (iId >= 0 && byId.get(Number(cells[iId]))) || (iName >= 0 && byName.get(norm(cells[iName])));
      const costText = String(cells[iCost] || '').replace(/RD\$/gi, '');
      if (!costText.trim()) return;  // sin costo: se deja como está
      if (!product) { errors.push('Fila ' + fila + ': no se encontró «' + (cells[iName] || cells[iId] || '') + '».'); return; }
      const costs = costText.split('/').map(v => Number(v.replace(/[^0-9.]/g, ''))).filter(v => v > 0);
      if (!costs.length) { errors.push('Fila ' + fila + ': costo no válido para ' + product.name + '.'); return; }
      const strategy = STRATEGIES[norm(cells[iStrategy])] || null;
      const competitor = iComp >= 0 ? Number(String(cells[iComp] || '').replace(/[^0-9.]/g, '')) || null : undefined;
      rows.push({ product, costs, strategy, competitor });
    });
    return { rows, errors };
  }

  return { SOLD, PENDING, norm, amounts, amountOf, money, balances, collected, waNumber, waLink, reminderText, restockText, validParams, marginAt,
    suggestPrice, suggestText, reviewPrice, currentProfit, parseLines, productIndex, sizeIndex, orderProfit, profitSummary, purchaseList, purchaseText,
    csvCell, toCsv, splitCsvLine, costsCsv, parseCostsCsv };
});
