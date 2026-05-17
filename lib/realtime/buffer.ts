import { bearing } from '@/lib/map/geo';
import type { InterpSample } from './types';

interface Sample {
  t: number;
  lat: number;
  lon: number;
}

export interface BufferConfig {
  /** Max plausible boat speed in m/s, used for outlier gate on the live stream. */
  maxSpeedMps: number;
  /** After this many consecutive rejected live samples, force-accept the next one. */
  forceAcceptAfter: number;
  /** Max time (ms) the sampler will extrapolate beyond the latest sample before freezing. */
  maxExtrapMs: number;
  /** If a live sample lands this far ahead of the previous live sample, treat as fresh-start. */
  resetGapMs: number;
  /** Baseline window for heading/speed derivation. */
  headingLookbackMs: number;
  /** Min displacement (meters) across the lookback window for the derived bearing to be trusted. */
  headingMinDistM: number;
  /** Gaussian smoothing sigma (ms) applied to position output. 0 = pure linear interp. */
  positionSmoothingMs: number;
}

export const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  maxSpeedMps: 25,
  forceAcceptAfter: 3,
  maxExtrapMs: 2500,
  resetGapMs: 5000,
  headingLookbackMs: 2000,
  headingMinDistM: 3,
  positionSmoothingMs: 800,
};

/** Equirectangular approximation — accurate enough for the few-hundred-meter outlier gate. */
function distMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const meanLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLat = (b.lat - a.lat) * (Math.PI / 180);
  const dLon = (b.lon - a.lon) * (Math.PI / 180) * Math.cos(meanLat);
  return Math.hypot(dLat, dLon) * 6371000;
}

/**
 * Append-only, time-sorted sample store for one boat plus a smoothing sampler.
 *
 * Live samples enter via `pushLive` and go through the outlier / gap-reset
 * filter. Backfilled historical chunks enter via `mergeRange` and are trusted
 * (no filtering, inserted at the correct sorted position). The sampler is
 * agnostic to where samples came from — given any server time it returns an
 * interpolated, Gaussian-smoothed reading, restricting the kernel to a small
 * window via binary search so the cost stays O(log N + K) where K is the
 * number of samples inside ±3σ (~5–6 for our 1 Hz feed).
 */
export class BoatHistory {
  private samples: Sample[] = [];
  private rejectStreak = 0;
  private readonly cfg: BufferConfig;

  constructor(cfg: BufferConfig = DEFAULT_BUFFER_CONFIG) {
    this.cfg = cfg;
  }

  hasData(): boolean {
    return this.samples.length > 0;
  }

  latestT(): number {
    const last = this.samples[this.samples.length - 1];
    return last ? last.t : 0;
  }

  firstT(): number {
    return this.samples[0]?.t ?? 0;
  }

  /** First index whose t >= target. */
  private lowerBound(t: number): number {
    let lo = 0;
    let hi = this.samples.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.samples[mid].t < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /**
   * Live-stream ingest with outlier / gap protection. Assumes the new sample
   * is at or near the latest known time (monotonic). Returns true if accepted.
   */
  pushLive(sample: Sample): boolean {
    if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lon) || !Number.isFinite(sample.t)) {
      return false;
    }
    const n = this.samples.length;
    const last = n > 0 ? this.samples[n - 1] : null;
    if (last) {
      if (sample.t <= last.t) {
        // Out-of-order or duplicate live sample — drop. (Backfill goes through mergeRange.)
        return false;
      }
      const dtMs = sample.t - last.t;
      if (dtMs > this.cfg.resetGapMs) {
        // Long gap — we kept the older samples for DVR seeking, but the smoother
        // should not interpolate across the gap. We rely on the renderT cursor
        // being inside one regime at a time; no need to drop history.
        this.rejectStreak = 0;
      } else {
        const v = distMeters(last, sample) / Math.max(dtMs / 1000, 0.001);
        const isOutlier = v > this.cfg.maxSpeedMps;
        if (isOutlier && this.rejectStreak < this.cfg.forceAcceptAfter) {
          this.rejectStreak++;
          return false;
        }
        this.rejectStreak = 0;
      }
    }
    this.samples.push(sample);
    return true;
  }

  /**
   * Bulk-merge a sorted-by-t batch of samples into the history. Used for
   * backfilled history chunks from the server. Inserts at the correct sorted
   * position via binary search and skips duplicates by exact `t` match.
   */
  mergeRange(samples: Sample[]): void {
    if (samples.length === 0) return;
    if (this.samples.length === 0) {
      this.samples = samples.slice();
      return;
    }
    // Common case: whole batch lands strictly before the first existing sample
    // (typical user-seeks-into-past pattern). Prepend in one shot.
    if (samples[samples.length - 1].t < this.samples[0].t) {
      this.samples = samples.concat(this.samples);
      return;
    }
    // Generic case: walk-and-merge via two-pointer scan.
    const merged: Sample[] = [];
    let i = 0;
    let j = 0;
    const a = this.samples;
    const b = samples;
    while (i < a.length && j < b.length) {
      if (a[i].t < b[j].t) {
        merged.push(a[i++]);
      } else if (a[i].t > b[j].t) {
        merged.push(b[j++]);
      } else {
        // Same timestamp — prefer existing (live) value.
        merged.push(a[i++]);
        j++;
      }
    }
    while (i < a.length) merged.push(a[i++]);
    while (j < b.length) merged.push(b[j++]);
    this.samples = merged;
  }

  /**
   * Return all samples whose t falls within [fromT, toT] inclusive. Used by
   * the engine to derive the trail when scrubbing.
   */
  rangeSlice(fromT: number, toT: number): Sample[] {
    const start = this.lowerBound(fromT);
    const end = this.lowerBound(toT + 1);
    return this.samples.slice(start, end);
  }

  private interpolatePosAt(serverT: number): { lat: number; lon: number; extrapolating: boolean } | null {
    const n = this.samples.length;
    if (n === 0) return null;
    if (n === 1) {
      const s = this.samples[0];
      return { lat: s.lat, lon: s.lon, extrapolating: true };
    }
    const first = this.samples[0];
    const last = this.samples[n - 1];
    if (serverT <= first.t) {
      return { lat: first.lat, lon: first.lon, extrapolating: true };
    }
    if (serverT >= last.t) {
      const prev = this.samples[n - 2];
      const segDtSec = (last.t - prev.t) / 1000;
      const overshootMs = Math.min(serverT - last.t, this.cfg.maxExtrapMs);
      const ratio = segDtSec > 0 ? overshootMs / 1000 / segDtSec : 0;
      return {
        lat: last.lat + (last.lat - prev.lat) * ratio,
        lon: last.lon + (last.lon - prev.lon) * ratio,
        extrapolating: true,
      };
    }
    const sigma = this.cfg.positionSmoothingMs;
    if (sigma <= 0) {
      // Linear fallback. Binary search for the bracket.
      const aIdx = this.lowerBound(serverT) - 1;
      const a = this.samples[aIdx];
      const b = this.samples[aIdx + 1];
      const span = b.t - a.t;
      const u = span > 0 ? (serverT - a.t) / span : 0;
      return {
        lat: a.lat + (b.lat - a.lat) * u,
        lon: a.lon + (b.lon - a.lon) * u,
        extrapolating: false,
      };
    }
    // Gaussian-weighted smoothing over the ±3σ window. Binary search for the
    // window start so the cost stays bounded regardless of total history size.
    const sigma2 = sigma * sigma;
    const cutoff = sigma * 3;
    const startIdx = this.lowerBound(serverT - cutoff);
    let wSum = 0;
    let latSum = 0;
    let lonSum = 0;
    for (let i = startIdx; i < n; i++) {
      const s = this.samples[i];
      const dt = s.t - serverT;
      if (dt > cutoff) break;
      const w = Math.exp(-(dt * dt) / (2 * sigma2));
      wSum += w;
      latSum += w * s.lat;
      lonSum += w * s.lon;
    }
    if (wSum === 0) {
      return { lat: first.lat, lon: first.lon, extrapolating: true };
    }
    return {
      lat: latSum / wSum,
      lon: lonSum / wSum,
      extrapolating: false,
    };
  }

  /** See header comment for the smoothing scheme. */
  sampleAt(serverT: number): InterpSample | null {
    const here = this.interpolatePosAt(serverT);
    if (!here) return null;
    const back = this.interpolatePosAt(serverT - this.cfg.headingLookbackMs);
    let bearingDeg: number | null = null;
    let speedMps = 0;
    if (back) {
      const d = distMeters(back, here);
      speedMps = d / (this.cfg.headingLookbackMs / 1000);
      if (d >= this.cfg.headingMinDistM) {
        bearingDeg = bearing([back.lat, back.lon], [here.lat, here.lon]);
      }
    }
    return {
      lat: here.lat,
      lon: here.lon,
      bearing: bearingDeg,
      speedMps,
      extrapolating: here.extrapolating,
    };
  }
}
