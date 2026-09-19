/* The build manifest changes with every production build. Never cache API/telemetry responses. */
importScripts('/offline-manifest.js');
const SHELL = `dsb-shell-${self.DSB_BUILD}`;
const TILES = 'dsb-satellite-v2';
const ASSETS = new Set(self.DSB_ASSETS);
const TILE_LIMIT = 120;

self.addEventListener('install', event => {
  // Installation is atomic: an offline-ready shell always includes its exact JS/CSS build.
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    try {
      await cache.addAll(self.DSB_ASSETS.map(path => new Request(path, {cache: 'reload'})));
    } catch (error) {
      await caches.delete(SHELL);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Keep one previous shell for tabs still running an earlier build.
    const previous = keys.filter(key => key.startsWith('dsb-shell-') && key !== SHELL);
    await Promise.all(previous.slice(0, -1).map(key => caches.delete(key)));
    await Promise.all(['map-tiles-v1', 'static-v1'].map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CHECK_OFFLINE') {
    event.waitUntil((async () => {
      const cache = await caches.open(SHELL);
      const ready = (await cache.keys()).length >= ASSETS.size && !!(await cache.match('/'));
      event.source?.postMessage({type: 'OFFLINE_READY', ready});
    })());
  }
});
let tileWrites = Promise.resolve();
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    // HTML is tied to this worker's precached build; RSC, API, HMR and live data bypass it.
    if (request.mode === 'navigate' && url.pathname === '/') {
      event.respondWith((async () => (await (await caches.open(SHELL)).match('/')) || fetch(request))());
      return;
    }
    if ((ASSETS.has(url.pathname) && url.pathname !== '/') || url.pathname.startsWith('/_next/static/')) {
      event.respondWith((async () => {
        const current = await (await caches.open(SHELL)).match(url.pathname);
        if (current) return current;
        if (url.pathname.startsWith('/_next/static/')) {
          for (const name of (await caches.keys()).filter(key => key.startsWith('dsb-shell-') && key !== SHELL)) {
            const previous = await (await caches.open(name)).match(url.pathname);
            if (previous) return previous;
          }
        }
        return fetch(request);
      })());
    }
    return;
  }
  if (url.hostname !== 'server.arcgisonline.com' || !url.pathname.startsWith('/ArcGIS/rest/services/World_Imagery/MapServer/tile/')) return;
  const responsePromise = (async () => {
    const cache = await caches.open(TILES);
    const hit = await cache.match(request);
    if (hit) return hit;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const copy = response.clone();
        tileWrites = tileWrites.then(async () => {
          await cache.put(request, copy);
          const keys = await cache.keys();
          await Promise.all(keys.slice(0, Math.max(0, keys.length - TILE_LIMIT)).map(key => cache.delete(key)));
        }).catch(() => { /* Storage pressure must never break rendering. */ });
      }
      return response;
    } catch { return new Response('', {status: 503}); }
  })();
  event.respondWith(responsePromise);
  event.waitUntil(responsePromise.then(() => tileWrites));
});
