'use strict';
// Precios de la tienda. En la base se guarda el precio a dos pagos (la mitad al recibir y la otra mitad en 15 días), que
// la tienda solo da a clientes que conoce. Al público se le muestra el precio de contado (10% menos, terminado en 50):
// en la página, las fichas, Google y la lista de precios. Código puro, sin pantalla: lo usan la tienda (tienda.js), el
// carrito (customer.js) y la publicación (scripts/build-catalog.mjs y scripts/lib). La base de datos calcula el mismo
// precio de contado al registrar el pedido (private.precio_contado); una prueba comprueba que coinciden.
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
  // Lo que ve el público: el precio de contado. El precio guardado en la base es el de dos pagos (lo usan el panel de
  // costos y la lista para clientes que la tienda conoce); en la página se muestra el de contado, y en oferta el precio de
  // oferta con «Antes» también de contado. price_2p guarda el de dos pagos para la lista de clientes.
  const cashOf = text => { const list = amounts(text); return list.length ? list.map(v => money(contado(v))).join(' / ') : text; };
  function publico(product) {
    if (!product || product.price_2p !== undefined) return product;
    if (product.original_price) return { ...product, original_price: cashOf(product.original_price), price_2p: null };
    if (!amounts(product.price).length) return { ...product, price_2p: null };
    return { ...product, price: cashOf(product.price), price_2p: product.price };
  }
  // Línea bajo el precio en la tarjeta y la ficha (el precio ya es el de contado).
  function planes(product) {
    return product && !product.original_price && amounts(product.price).length ? 'Precio de contado · pagas al recibir' : '';
  }
  // Para la lista de clientes: «2 pagos de RD$2,225» (cada presentación) a partir del precio de dos pagos.
  function dosPagosTexto(product) {
    const list = amounts(product && product.price_2p);
    return list.length ? list.map(v => '2 pagos de ' + money(cuota(v))).join(' / ') : '';
  }
  // Total del carrito según la forma de pago. Las líneas en oferta (offer: true) no llevan el 10% de contado.
  function totalCarrito(items, plan) {
    return (items || []).reduce((sum, item) => {
      const unit = Number(item.unit_price) || 0, qty = Number(item.qty) || 1;
      return sum + (plan === 'contado' && !item.offer ? contado(unit) : unit) * qty;
    }, 0);
  }
  return { DESCUENTO_CONTADO, DIAS_SEGUNDO_PAGO, amounts, money, contado, cuota, contadoTexto, cashOf, publico, planes, dosPagosTexto, totalCarrito };
});
