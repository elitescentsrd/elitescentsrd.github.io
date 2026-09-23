'use strict';
// Service worker de Elite Scents RD: hace la tienda instalable y más rápida sin mostrar datos viejos.
//  - Páginas, CSS y JavaScript del sitio: primero la red (siempre lo más nuevo). Sin internet se usa la última copia guardada.
//  - Imágenes y fuentes: se muestran desde la copia guardada y se renuevan en segundo plano.
//  - NUNCA se guardan: el panel (/admin), el carrito y las cuentas (/checkout), ni Supabase ni ninguna dirección externa.
//    Si el panel o el carrito se abren sin internet (por ejemplo, desde la app instalada), se muestra el aviso "Sin conexión".
// En cada publicación el build reemplaza el marcador de versión de la línea siguiente: así las copias viejas se borran solas.
const VERSION = 'elite-v__BUILD_ID__';
const STATIC = VERSION + '-static';
const PAGES = VERSION + '-pages';
const IMAGES = VERSION + '-images';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/tienda.css', '/logo-oficial.webp', '/img/app/icon-192.png'];
const LIMITS = { [PAGES]: 60, [IMAGES]: 150 };
const NEVER_CACHE = /^\/(admin|checkout|customer)(\.|\/|$)/;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(STATIC).then(cache => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([STATIC, PAGES, IMAGES]);
    for (const name of await caches.keys()) if (name.startsWith('elite-v') && !keep.has(name)) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function trim(name) {
  const cache = await caches.open(name), keys = await cache.keys(), max = LIMITS[name];
  if (max && keys.length > max) for (const request of keys.slice(0, keys.length - max)) await cache.delete(request);
}

async function remember(name, request, response) {
  if (!response || !response.ok || response.type !== 'basic') return;
  // La copia se hace de inmediato (antes de cualquier await): después el navegador ya puede haber empezado a leer la respuesta.
  const copy = response.clone();
  const cache = await caches.open(name);
  await cache.put(request, copy);
  trim(name);
}

async function networkFirst(request, name) {
  try {
    const response = await fetch(request);
    remember(name, request, response);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return (await caches.match(OFFLINE_URL)) || Response.error();
    return Response.error();
  }
}

async function staleWhileRevalidate(request, name) {
  const cached = await caches.match(request);
  const refresh = fetch(request).then(response => { remember(name, request, response); return response; }).catch(() => null);
  return cached || (await refresh) || Response.error();
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (NEVER_CACHE.test(url.pathname)) {
    // Siempre desde la red y sin guardar copia; solo si no hay conexión se muestra la página "Sin conexión".
    if (request.mode === 'navigate') event.respondWith(fetch(request).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
    return;
  }
  if (request.mode === 'navigate') { event.respondWith(networkFirst(request, PAGES)); return; }
  if (/\.(?:css|js|json|webmanifest)$/i.test(url.pathname)) { event.respondWith(networkFirst(request, STATIC)); return; }
  if (/\.(?:webp|png|jpe?g|gif|svg|ico|woff2?)$/i.test(url.pathname)) event.respondWith(staleWhileRevalidate(request, IMAGES));
});
