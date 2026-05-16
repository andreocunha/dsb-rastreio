import { BoatBuffer, DEFAULT_BUFFER_CONFIG, type BufferConfig } from './buffer';
import { ServerClock } from './clock';
import type { InterpSample, PositionUpdate } from './types';

export interface SourceConfig extends BufferConfig {
  /**
   * How far in the past (ms) the sampler reads. A delay of ~1.5× the broadcast
   * interval guarantees we always interpolate between two real samples rather
   * than extrapolating. 1500ms is a good default for 1Hz updates.
   */
  interpDelayMs: number;
}

export const DEFAULT_SOURCE_CONFIG: SourceConfig = {
  ...DEFAULT_BUFFER_CONFIG,
  interpDelayMs: 3000,
};

/**
 * Aggregates per-boat buffers and provides a single sampling entry point.
 * Owns the server clock so all reads share the same time axis.
 */
export class RealtimeSource {
  private readonly buffers = new Map<string, BoatBuffer>();
  private readonly clock = new ServerClock();
  private readonly cfg: SourceConfig;
  private lastIngestAt = 0;

  constructor(cfg: SourceConfig = DEFAULT_SOURCE_CONFIG) {
    this.cfg = cfg;
  }

  ingest(update: PositionUpdate): boolean {
    this.clock.observe(update.t);
    this.lastIngestAt = Date.now();
    let buf = this.buffers.get(update.id);
    if (!buf) {
      buf = new BoatBuffer(this.cfg);
      this.buffers.set(update.id, buf);
    }
    return buf.push({ t: update.t, lat: update.lat, lon: update.lon });
  }

  /** Sample a boat at "now - interpDelay" on the server clock. */
  sampleBoat(id: string): InterpSample | null {
    const buf = this.buffers.get(id);
    if (!buf || !buf.hasData()) return null;
    const renderT = this.clock.now() - this.cfg.interpDelayMs;
    return buf.sampleAt(renderT);
  }

  hasAnyData(): boolean {
    for (const b of this.buffers.values()) {
      if (b.hasData()) return true;
    }
    return false;
  }

  /** Useful for UI status: ms since the last successful ingest. */
  msSinceLastIngest(): number {
    return this.lastIngestAt === 0 ? Infinity : Date.now() - this.lastIngestAt;
  }
}
