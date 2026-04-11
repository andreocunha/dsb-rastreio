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
      this.cache.delete(key);
      this.cache.set(key, img);
    }
    return img;
  }

  has(key: string): boolean {
    return this.cache.has(key);
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

  /** Count how many tiles are cached for a given viewport */
  countLoaded(
    zi: number, x0: number, x1: number, y0: number, y1: number,
  ): { loaded: number; total: number } {
    const mx = 1 << zi;
    let loaded = 0;
    let total = 0;
    for (let tx = x0; tx <= x1; tx++) {
      for (let ty = y0; ty <= y1; ty++) {
        if (ty < 0 || ty >= mx) continue;
        total++;
        const wx = ((tx % mx) + mx) % mx;
        if (this.cache.has(`${zi}/${wx}/${ty}`)) loaded++;
      }
    }
    return { loaded, total };
  }

  /** Find a cached tile at a different zoom to use as placeholder */
  findFallback(z: number, tx: number, ty: number): TileFallback | null {
    const ts = this.config.tileSize;

    // Search parents (lower zoom)
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

    // Search children (higher zoom)
    for (let dz = 1; dz <= 3; dz++) {
      const cz = z + dz;
      if (cz > this.config.zoomMax) break;
      const cx = tx << dz;
      const cy = ty << dz;
      const k = `${cz}/${cx}/${cy}`;
      const img = this.cache.get(k);
      if (img) {
        return { img, sx: 0, sy: 0, sw: ts, sh: ts };
      }
    }

    return null;
  }

  private evictIfNeeded(): void {
    while (this.cache.size >= this.config.maxCachedTiles) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
      else break;
    }
  }
}
