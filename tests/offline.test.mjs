import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');

function harness({failInstall = false, offline = false} = {}) {
  const listeners = {}, stores = new Map(), network = [], messages = [];
  const key = request => typeof request === 'string' ? new URL(request, 'https://race.test').href : request.url;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async addAll(requests) { if (failInstall) throw Error('network interrupted'); for (const r of requests) store.set(key(r), new Response(r.url)); },
        async match(request) { return store.get(key(request))?.clone(); },
        async put(request, response) { store.set(key(request), response); },
        async keys() { return [...store.keys()].map(url => new Request(url)); },
        async delete(request) { return store.delete(key(request)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const self = { DSB_BUILD: 'test', DSB_ASSETS: ['/', '/_next/static/app.js', '/_next/static/app.css'], location: {origin: 'https://race.test'}, clients: {claim: async () => {}}, skipWaiting: async () => {}, addEventListener: (type, fn) => {listeners[type] = fn;} };
  class LocalRequest extends Request { constructor(input, options) { super(typeof input === 'string' ? new URL(input, self.location.origin) : input, options); } }
  vm.runInNewContext(source, {self, caches, importScripts() {}, Request: LocalRequest, Response, URL, fetch: async request => {network.push(key(request)); if (offline) throw Error('offline'); return new Response('network');}});
  async function event(type, rest = {}) {
    const jobs = []; let response;
    listeners[type]({waitUntil: promise => jobs.push(promise), respondWith: promise => {response = promise;}, source: {postMessage: message => messages.push(message)}, ...rest});
    const result = response ? await response : undefined;
    await Promise.all(jobs);
    return result;
  }
  const fetchRequest = (path, mode = 'cors') => ({url: new URL(path, self.location.origin).href, method: 'GET', mode});
  return {event, fetchRequest, stores, caches, network, messages};
}

test('installed HTML and its exact JS/CSS load offline without network access', async () => {
  const h = harness({offline: true});
  await h.event('install');
  for (const [path, mode] of [['/?source=installed', 'navigate'], ['/_next/static/app.js','cors'], ['/_next/static/app.css','cors']]) {
    const response = await h.event('fetch', {request: h.fetchRequest(path, mode)});
    assert.equal(response.status, 200);
  }
  assert.deepEqual(h.network, []);
  await h.event('message', {data: {type: 'CHECK_OFFLINE'}});
  assert.equal(h.messages[0].ready, true);
});
test('failed installation removes the incomplete shell and preserves the old version', async () => {
  const h = harness({failInstall: true});
  await h.caches.open('dsb-shell-previous');
  await assert.rejects(h.event('install'));
  assert.equal(h.stores.has('dsb-shell-test'), false);
  assert.equal(h.stores.has('dsb-shell-previous'), true);
});
test('live APIs, RSC requests, other pages and non-GET requests bypass the cache', async () => {
  const h = harness();
  for (const request of [h.fetchRequest('/api/positions'), h.fetchRequest('/?_rsc=abc'), h.fetchRequest('/admin','navigate'), {...h.fetchRequest('/'), method:'POST'}]) {
    assert.equal(await h.event('fetch',{request}), undefined);
  }
});
test('activation keeps foreign caches and one previous app build', async () => {
  const h = harness();
  for (const name of ['other-app','dsb-shell-older','dsb-shell-previous','dsb-shell-test']) await h.caches.open(name);
  await h.event('activate');
  assert.deepEqual(await h.caches.keys(), ['other-app','dsb-shell-previous','dsb-shell-test']);
});
test('offline-ready is false when a required app file is missing', async () => {
  const h = harness(); await h.event('install');
  await (await h.caches.open('dsb-shell-test')).delete('/_next/static/app.js');
  await h.event('message', {data:{type:'CHECK_OFFLINE'}});
  assert.equal(h.messages[0].ready, false);
});
test('optional satellite cache is bounded and usable offline', async () => {
  const h = harness();
  for (let i=0;i<125;i++) await h.event('fetch',{request: h.fetchRequest(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/100/${i}`)});
  assert.equal(h.stores.get('dsb-satellite-v2').size, 120);
  const before = h.network.length;
  await h.event('fetch',{request: h.fetchRequest('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/16/100/124')});
  assert.equal(h.network.length, before);
});
