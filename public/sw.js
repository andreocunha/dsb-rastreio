/* The build manifest changes with every production build. Never cache API/telemetry responses. */
importScripts('/offline-manifest.js');
const SHELL = `dsb-shell-${self.DSB_BUILD}`;
const TILES = 'dsb-satellite-v2';
const ASSETS = new Set(self.DSB_ASSETS);
const TILE_LIMIT = 120;
/** How long opening the site waits for the network before using the installed copy. */
const NAVIGATION_TIMEOUT = 2500;

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
    // Updates apply by themselves: no "update" button. Open pages decide when to reload (see MapCanvas).
    await self.skipWaiting();
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
    // Not awaited: reloading a page needs this worker to answer its request, which only happens once
    // activation has finished (awaiting here would deadlock).
    reloadLegacyPages();
  })());
});
/**
 * Map pages from before automatic updates wait for a click on "Nova versão disponível" that can no
 * longer do anything (this worker has already taken over), so the notice would stay forever. Pages
 * of the current generation answer this ping and reload themselves at a quiet moment; the silent
 * ones are reloaded now. Only the map: never an organizer page with work in progress.
 */
async function reloadLegacyPages() {
  const pages = (await self.clients.matchAll({type: 'window'})).filter(client => new URL(client.url).pathname === '/');
  await Promise.all(pages.map(async client => {
    const channel = new MessageChannel();
    const current = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 1500);
      channel.port1.onmessage = () => { clearTimeout(timer); resolve(true); };
      try { client.postMessage({type: 'AUTO_UPDATE?'}, [channel.port2]); } catch { clearTimeout(timer); resolve(false); }
    });
    channel.port1.close();
    if (!current) client.navigate(client.url).catch(() => { /* closed meanwhile */ });
  }));
}
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
    // The page: the latest deployment when the network answers quickly, so opening the site shows the
    // new version straight away; the installed shell when offline or on a slow venue connection.
    // RSC, API, HMR and live data bypass the worker.
    if (request.mode === 'navigate' && url.pathname === '/') {
      event.respondWith((async () => {
        const cached = (await caches.open(SHELL)).match('/');
        const network = fetch(request).then(response => response.ok ? response : Promise.reject(Error(String(response.status))));
        network.catch(() => { /* answered from the installed copy */ });
        let timer;
        const slow = new Promise(resolve => { timer = setTimeout(resolve, NAVIGATION_TIMEOUT); });
        try {
          const first = await Promise.race([network, slow]);
          if (first) return first;
          return (await cached) || await network;
        } catch {
          return (await cached) || fetch(request);
        } finally { clearTimeout(timer); }
      })());
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
        const response=await fetch(request);
        if(response.ok){const cache=await caches.open(SHELL);await cache.put(request,response.clone()).catch(()=>{});}
        return response;
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
