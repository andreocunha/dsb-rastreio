import { bearing } from '@/lib/map/geo';
import type { InterpSample } from './types';

interface Sample {
  t: number;
  lat: number;
  lon: number;
}

export interface BufferConfig {
  /** Maximum samples kept per boat (older are discarded). */
  capacity: number;
  /** Max plausible boat speed in m/s, used for outlier gate. ~25 m/s ≈ 50 knots. */
  maxSpeedMps: number;
  /** After this many consecutive rejected samples, force-accept the next one (handles legitimate teleport / reconnect). */
  forceAcceptAfter: number;
  /** Max time (ms) the sampler will extrapolate beyond the latest sample before freezing. */
  maxExtrapMs: number;
  /**
   * If an incoming sample's timestamp is this far ahead of the latest accepted
   * sample, treat it as the start of a fresh connection: drop accumulated
   * history and re-seed the buffer from this point. Prevents a multi-second
   * "warp slide" interpolation across server restarts, network outages, or
   * tab-throttling pauses.
   */
  resetGapMs: number;
  /** Baseline window for heading/speed derivation. Longer = more noise rejection but slower to react to real turns. */
  headingLookbackMs: number;
  /** Min displacement (meters) across the lookback window for the derived bearing to be trusted. */
  headingMinDistM: number;
  /**
   * Gaussian smoothing sigma (ms) applied to the position output. Set to 0 for
   * pure linear interpolation. With 1Hz samples and 1–2 m of GPS noise on
   * slow-moving boats (2–3 m/s), 800 ms smooths the noise into a soft drift
   * instead of a visible zigzag between adjacent samples.
   */
  positionSmoothingMs: number;
}

export const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  capacity: 16,
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
 * Ring buffer of GPS samples for one boat plus the sampler that produces a
 * smooth (lat, lon, bearing, speed) reading for any past server time.
 *
 * Outlier rejection runs at ingest time. The sampler does linear interpolation
 * between consecutive accepted samples, with bounded extrapolation when the
 * caller asks for a time slightly past the latest known sample (covers small
 * network gaps without freezing the boat).
 */
export class BoatBuffer {
  private samples: Sample[] = [];
  private rejectStreak = 0;
  private readonly cfg: BufferConfig;

  constructor(cfg: BufferConfig = DEFAULT_BUFFER_CONFIG) {
    this.cfg = cfg;
  }

  /** Ingest a raw sample. Returns true if accepted, false if rejected as outlier. */
  push(sample: Sample): boolean {
    if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lon) || !Number.isFinite(sample.t)) {
      return false;
    }
    const last = this.samples[this.samples.length - 1];
    if (last) {
      if (sample.t <= last.t) return false;
      const dtMs = sample.t - last.t;
      if (dtMs > this.cfg.resetGapMs) {
        // Long data gap — discard stale history so we don't interpolate across it.
        this.samples = [];
      } else {
        const v = distMeters(last, sample) / Math.max(dtMs / 1000, 0.001);
        const isOutlier = v > this.cfg.maxSpeedMps;
        if (isOutlier && this.rejectStreak < this.cfg.forceAcceptAfter) {
          this.rejectStreak++;
          return false;
        }
        if (isOutlier) {
          // Force-accept: drop pre-jump history so the smoother doesn't span the
          // synthetic high-speed segment.
          this.samples = [last];
        }
      }
    }
    this.rejectStreak = 0;
    this.samples.push(sample);
    if (this.samples.length > this.cfg.capacity) this.samples.shift();
    return true;
  }

  /** Latest accepted server timestamp, or 0 if empty. */
  latestT(): number {
    const last = this.samples[this.samples.length - 1];
    return last ? last.t : 0;
  }

  hasData(): boolean {
    return this.samples.length > 0;
  }

  /**
   * Pure position interpolation at the given server time — no bearing here.
   *
   * Inside the buffer's time range, applies a Gaussian-weighted average of
   * nearby samples (kernel smoother) to suppress per-sample GPS noise. The
   * standard deviation of the kernel is `positionSmoothingMs`; with samples at
   * ~1 Hz and σ ≈ 800 ms, ~3 samples carry meaningful weight, giving roughly a
   * √3 noise reduction at the cost of softening sub-second motion features.
   *
   * Outside the buffer range, falls back to clamp (before) or capped linear
   * extrapolation (after) — same behavior as before.
   */
  private interpolatePosAt(serverT: number): { lat: number; lon: number; extrapolating: boolean } | null {
    const n = this.samples.length;
    if (n === 0) return null;
    if (n === 1) {
      // Warmup — single sample, no interp possible.
      const s = this.samples[0];
      return { lat: s.lat, lon: s.lon, extrapolating: true };
    }
    const first = this.samples[0];
    const last = this.samples[n - 1];
    if (serverT <= first.t) {
      // Clamped before the buffer starts — synthesizing position, not interpolating.
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
      // Linear interpolation fallback (no smoothing).
      let aIdx = 0;
      for (let i = n - 2; i >= 0; i--) {
        if (this.samples[i].t <= serverT) { aIdx = i; break; }
      }
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
    const sigma2 = sigma * sigma;
    const cutoff = sigma * 3;
    let wSum = 0;
    let latSum = 0;
    let lonSum = 0;
    for (let i = 0; i < n; i++) {
      const s = this.samples[i];
      const dt = s.t - serverT;
      if (dt < -cutoff || dt > cutoff) continue;
      const w = Math.exp(-(dt * dt) / (2 * sigma2));
      wSum += w;
      latSum += w * s.lat;
      lonSum += w * s.lon;
    }
    if (wSum === 0) {
      // Shouldn't happen: serverT lies between first.t and last.t, so at least
      // one sample falls inside ±3σ of any reasonable σ.
      return { lat: first.lat, lon: first.lon, extrapolating: false };
    }
    return {
      lat: latSum / wSum,
      lon: lonSum / wSum,
      extrapolating: false,
    };
  }

  /**
   * Produce an interpolated reading at the given server time. Returns null if
   * the buffer is empty.
   *
   * Position uses linear interpolation between bracketing samples, with bounded
   * extrapolation past the latest sample.
   *
   * Bearing/speed are derived from a *long baseline* — the interpolated
   * position at `serverT - headingLookbackMs` to the position at `serverT`.
   * Over ~16 m of motion the heading is stable against per-sample GPS noise,
   * removing the per-second swing you'd get from raw segment-to-segment bearings.
   */
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
