'use strict';
// Formas de pago de la tienda: «a dos pagos» (el precio del catálogo: la mitad al recibir y la otra mitad en 15 días)
// y «de contado» (10% menos). Código puro, sin pantalla: lo usan la tienda (tienda.js), el carrito (customer.js) y las
// páginas de cada perfume (scripts/lib/seo.mjs). La base de datos calcula el mismo precio de contado al registrar el
// pedido (private.precio_contado en supabase/migrations/20261110200000_dos_precios.sql); una prueba comprueba que coinciden.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.ElitePagos = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DESCUENTO_CONTADO = 0.10, DIAS_SEGUNDO_PAGO = 15;
  const amounts = value => (String(value || '').match(/[0-9][0-9,]*/g) || []).map(v => Number(v.replace(/,/g, ''))).filter(v => v > 0);
  const money = n => 'RD$' + Math.round(n).toLocaleString('en-US');
  // Precio de contado de un monto: 10% menos, terminado en 50 como los demás precios (4,450 → 4,050; 3,050 → 2,750).
  const contado = value => Math.round((value * (1 - DESCUENTO_CONTADO) - 50) / 100) * 100 + 50;
  // Cada pago cuando son dos: la mitad, sin centavos (el primero lleva el peso que sobre).
  const cuota = value => Math.floor(value / 2);
  // Texto del precio de contado de un perfume ("RD$3,550 / RD$4,250" → "RD$3,150 / RD$3,800"). Un perfume en oferta no
  // tiene precio de contado aparte: la oferta ya es su precio.
  function contadoTexto(product) {
    if (!product || product.original_price) return '';
    const list = amounts(product.price);
    return list.length ? list.map(v => money(contado(v))).join(' / ') : '';
  }
  // Texto corto para la tarjeta y la ficha: «2 pagos de RD$2,225 · Contado RD$4,050».
  function planes(product) {
    const cash = contadoTexto(product), list = amounts(product && product.price);
    if (!cash) return '';
    return (list.length === 1 ? '2 pagos de ' + money(cuota(list[0])) + ' · ' : 'A dos pagos o ') + 'Contado ' + cash;
  }
  // Total del carrito según la forma de pago. Las líneas en oferta (offer: true) no llevan el 10% de contado.
  function totalCarrito(items, plan) {
    return (items || []).reduce((sum, item) => {
      const unit = Number(item.unit_price) || 0, qty = Number(item.qty) || 1;
      return sum + (plan === 'contado' && !item.offer ? contado(unit) : unit) * qty;
    }, 0);
  }
  return { DESCUENTO_CONTADO, DIAS_SEGUNDO_PAGO, amounts, money, contado, cuota, contadoTexto, planes, totalCarrito };
});
