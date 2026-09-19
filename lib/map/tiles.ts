import type { TileFallback, MapConfig } from './types';

/** Optional satellite imagery: bounded memory, six requests at a time, no offline retry storm. */
export class TileCache {
  revision = 0;
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Map<string, HTMLImageElement>();
  private queue = new Map<string, [number, number, number]>();
  private failures = new Map<string, number>();
  private alive = true;
  constructor(private config: MapConfig) {
    window.addEventListener('online', this.online);
  }
  private online = () => { this.failures.clear(); this.revision++; };
  get(key: string) {
    const img = this.cache.get(key);
    if (img) { this.cache.delete(key); this.cache.set(key, img); }
    return img;
  }
  load(key: string, z: number, x: number, y: number) {
    if (!this.alive || this.cache.has(key) || this.loading.has(key) || this.queue.has(key) || this.failures.has(key) || !navigator.onLine) return;
    // Keep pending requests bounded while dragging quickly.
    if (this.queue.size >= 100) this.queue.delete(this.queue.keys().next().value!);
    this.queue.set(key, [z, x, y]);
    this.pump();
  }
  private pump() {
    while (this.alive && this.loading.size < 6 && this.queue.size) {
      const [key, [z, x, y]] = this.queue.entries().next().value!;
      this.queue.delete(key);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      this.loading.set(key, img);
      const complete = () => { this.loading.delete(key); this.revision++; this.pump(); };
      img.onload = () => {
        if (!this.alive) return;
        while (this.cache.size >= this.config.maxCachedTiles) this.cache.delete(this.cache.keys().next().value!);
        this.cache.set(key, img);
        complete();
      };
      img.onerror = () => {
        if (!this.alive) return;
        this.failures.set(key, Date.now());
        complete();
      };
      img.src = `${this.config.tileUrl}/${z}/${y}/${x}`;
    }
  }
  countLoaded(zi: number, x0: number, x1: number, y0: number, y1: number) {
    const mx = 1 << zi;
    let loaded = 0, total = 0;
    for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= mx) continue;
      total++;
      if (this.cache.has(`${zi}/${((tx % mx) + mx) % mx}/${ty}`)) loaded++;
    }
    return { loaded, total };
  }
  findFallback(z: number, tx: number, ty: number): TileFallback | null {
    for (let dz = 1; dz <= 5; dz++) {
      if (z - dz < 0) break;
      const img = this.cache.get(`${z - dz}/${tx >> dz}/${ty >> dz}`);
      if (img) {
        const sub = 1 << dz, size = this.config.tileSize / sub;
        return { img, sx: (((tx % sub) + sub) % sub) * size, sy: (((ty % sub) + sub) % sub) * size, sw: size, sh: size };
      }
    }
    return null;
  }
  destroy() {
    this.alive = false;
    window.removeEventListener('online', this.online);
    for (const img of this.loading.values()) { img.onload = null; img.onerror = null; img.src = ''; }
    this.loading.clear(); this.queue.clear(); this.cache.clear();
  }
}
