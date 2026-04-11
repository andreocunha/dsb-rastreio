import type { TileFallback, MapConfig } from './types';

export class TileCache {
  private cache = new Map<string, HTMLImageElement>();
  private loading = new Set<string>();
  private config: MapConfig;

  constructor(config: MapConfig) {
    this.config = config;
  }

  get(key: string): HTMLImageElement | undefined {
    const img = this.cache.get(key);
    if (img) {
      // Move to end (most recently used) — Map preserves insertion order
      this.cache.delete(key);
      this.cache.set(key, img);
    }
    return img;
  }

  load(key: string, z: number, x: number, y: number): void {
    if (this.cache.has(key) || this.loading.has(key)) return;

    this.loading.add(key);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.loading.delete(key);
      this.evictIfNeeded();
      this.cache.set(key, img);
    };
    img.onerror = () => {
      this.loading.delete(key);
    };
    img.src = `${this.config.tileUrl}/${z}/${y}/${x}`;
  }

  /** Find a cached parent tile to use as placeholder */
  findFallback(z: number, tx: number, ty: number): TileFallback | null {
    const ts = this.config.tileSize;
    for (let dz = 1; dz <= 5; dz++) {
      const pz = z - dz;
      if (pz < 0) break;
      const px = tx >> dz;
      const py = ty >> dz;
      const k = `${pz}/${px}/${py}`;
      const img = this.cache.get(k);
      if (img) {
        const sub = 1 << dz;
        const sx = ((tx % sub) + sub) % sub;
        const sy = ((ty % sub) + sub) % sub;
        const ss = ts / sub;
        return { img, sx: sx * ss, sy: sy * ss, sw: ss, sh: ss };
      }
    }
    return null;
  }

  private evictIfNeeded(): void {
    while (this.cache.size >= this.config.maxCachedTiles) {
      // Map.keys().next() gives the oldest entry (first inserted)
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
      else break;
    }
  }
}
