import { BoatHistory, DEFAULT_BUFFER_CONFIG, type BufferConfig } from './buffer';
import { ServerClock } from './clock';
import type { InterpSample, PositionUpdate, InitMessage, HistoryMessage } from './types';

export interface SourceConfig extends BufferConfig {
  /** How far behind serverNow the live sampler reads. ~3× broadcast interval gives bracketing. */
  interpDelayMs: number;
  /** When seeking, request this much past the seek target to pre-fill the buffer. */
  prefetchAheadMs: number;
  /** When seeking, also request this much before the seek target for smoother lookback. */
  prefetchBehindMs: number;
  /** During DVR playback, request the next chunk when within this many ms of the covered end. */
  prefetchTriggerMs: number;
}

export const DEFAULT_SOURCE_CONFIG: SourceConfig = {
  ...DEFAULT_BUFFER_CONFIG,
  interpDelayMs: 3000,
  prefetchAheadMs: 60_000,
  prefetchBehindMs: 8_000,
  prefetchTriggerMs: 20_000,
};

type Range = [number, number]; // [from, to] inclusive

export type HistoryRequester = (from: number, to: number, reqId: string) => void;

/**
 * Maintains per-boat sample history, server clock sync, coverage tracking,
 * and chunk requests. Decoupled from the WebSocket transport: callers wire
 * `requester` to whatever channel sends `getHistory` to the server, and feed
 * messages back via the ingest methods.
 */
export class RealtimeSource {
  private readonly histories = new Map<string, BoatHistory>();
  private readonly clock = new ServerClock();
  private readonly cfg: SourceConfig;
  /** Sorted, disjoint, inclusive ranges of server-time that have been delivered. */
  private coverage: Range[] = [];
  /** Pending getHistory requests, indexed by reqId. Used to dedupe and skip overlap. */
  private pending = new Map<string, Range>();
  private reqCounter = 0;
  private _raceStartT = 0;
  private requester: HistoryRequester | null = null;

  constructor(cfg: SourceConfig = DEFAULT_SOURCE_CONFIG) {
    this.cfg = cfg;
  }

  setRequester(fn: HistoryRequester | null): void {
    this.requester = fn;
  }

  /** Ingest the init message (sent once on connect). Resets clock sync and seeds coverage from the tail. */
  ingestInit(msg: InitMessage): void {
    this.clock.observe(msg.serverT);
    this._raceStartT = msg.raceStartT || this._raceStartT;
    if (msg.tail.length > 0) {
      const tailFrom = Math.min(...msg.tail.map((u) => u.t));
      const tailTo = Math.max(...msg.tail.map((u) => u.t));
      this.bulkInsertHistory(msg.tail);
      this.addCoverage([tailFrom, tailTo]);
    }
  }

  /** Live broadcast: every update is the latest known position. Extends coverage forward. */
  ingestLive(updates: PositionUpdate[]): void {
    if (updates.length === 0) return;
    let maxT = 0;
    let minT = Infinity;
    for (const u of updates) {
      this.clock.observe(u.t);
      const h = this.getOrCreate(u.id);
      h.pushLive({ t: u.t, lat: u.lat, lon: u.lon });
      if (u.t > maxT) maxT = u.t;
      if (u.t < minT) minT = u.t;
    }
    if (Number.isFinite(minT)) this.addCoverage([minT, maxT]);
    // Race-start fallback for the case where the client connected before any
    // sample existed and the init message had raceStartT === 0.
    if (this._raceStartT === 0 && Number.isFinite(minT)) this._raceStartT = minT;
  }

  /** Server response to getHistory — merge samples and mark range covered. */
  ingestHistory(msg: HistoryMessage): void {
    if (msg.samples.length > 0) this.bulkInsertHistory(msg.samples);
    this.addCoverage([msg.from, msg.to]);
    if (msg.reqId) this.pending.delete(msg.reqId);
  }

  setRaceStart(t: number): void { this._raceStartT = t; }
  raceStartT(): number { return this._raceStartT; }

  /** Most recent live sample t across any boat. */
  latestLiveT(): number {
    let max = 0;
    for (const h of this.histories.values()) {
      const t = h.latestT();
      if (t > max) max = t;
    }
    return max;
  }

  /** Best-estimate current server time. */
  serverNow(): number { return this.clock.now(); }
  /** The time we render in live mode (slightly behind serverNow for interp). */
  liveRenderT(): number { return this.clock.now() - this.cfg.interpDelayMs; }

  /**
   * True if `serverT` is inside a covered range (with a small margin so the
   * smoother window doesn't need to peek past the coverage edge).
   */
  hasDataAt(serverT: number): boolean {
    const margin = this.cfg.headingLookbackMs + this.cfg.positionSmoothingMs * 3;
    return this.isCovered(serverT - margin, serverT);
  }

  /** True if any chunk request is outstanding. */
  isLoading(): boolean { return this.pending.size > 0; }

  /**
   * Ensure data covers `[targetT - prefetchBehindMs, targetT + prefetchAheadMs]`.
   * Dispatches requests for whichever sub-ranges are missing and not already
   * in flight. Cheap to call every frame: only sends requests for genuine gaps.
   */
  ensureCoverage(targetT: number): void {
    if (!this.requester) return;
    const from = targetT - this.cfg.prefetchBehindMs;
    const to = targetT + this.cfg.prefetchAheadMs;
    const gaps = this.findGaps(from, to);
    for (const [gFrom, gTo] of gaps) {
      // Lookahead-only gaps (entirely at/past the playhead) are throttled by
      // prefetchTriggerMs so the playhead advancing a few ms per frame doesn't
      // spam tiny requests. Seek-back gaps (which include data we need now)
      // bypass the throttle so the UI can load immediately.
      if (gFrom >= targetT && gTo - gFrom < this.cfg.prefetchTriggerMs) continue;
      if (this.alreadyPending(gFrom, gTo)) continue;
      const reqId = `r${++this.reqCounter}`;
      this.pending.set(reqId, [gFrom, gTo]);
      this.requester(gFrom, gTo, reqId);
    }
  }

  /** Sample a boat at a specific server time. */
  sampleBoatAt(id: string, serverT: number): InterpSample | null {
    return this.histories.get(id)?.sampleAt(serverT) ?? null;
  }

  /** Raw samples in [fromT, toT] inclusive — used by the engine to draw DVR trails. */
  trailSamples(id: string, fromT: number, toT: number): Array<{ t: number; lat: number; lon: number }> {
    return this.histories.get(id)?.rangeSlice(fromT, toT) ?? [];
  }

  // --- internal ---

  private getOrCreate(id: string): BoatHistory {
    let h = this.histories.get(id);
    if (!h) {
      h = new BoatHistory(this.cfg);
      this.histories.set(id, h);
    }
    return h;
  }

  /** Group bulk samples by boat and merge into each history in one pass. */
  private bulkInsertHistory(samples: PositionUpdate[]): void {
    const byBoat = new Map<string, Array<{ t: number; lat: number; lon: number }>>();
    for (const s of samples) {
      let arr = byBoat.get(s.id);
      if (!arr) { arr = []; byBoat.set(s.id, arr); }
      arr.push({ t: s.t, lat: s.lat, lon: s.lon });
    }
    for (const [id, arr] of byBoat) {
      arr.sort((a, b) => a.t - b.t);
      this.getOrCreate(id).mergeRange(arr);
    }
  }

  private addCoverage([from, to]: Range): void {
    if (to < from) return;
    const next: Range[] = [];
    let i = 0;
    // Skip ranges that end before the new one starts.
    while (i < this.coverage.length && this.coverage[i][1] < from - 1) {
      next.push(this.coverage[i++]);
    }
    // Merge overlapping / adjacent ranges into [from, to].
    let merged: Range = [from, to];
    while (i < this.coverage.length && this.coverage[i][0] <= merged[1] + 1) {
      merged = [Math.min(merged[0], this.coverage[i][0]), Math.max(merged[1], this.coverage[i][1])];
      i++;
    }
    next.push(merged);
    while (i < this.coverage.length) next.push(this.coverage[i++]);
    this.coverage = next;
  }

  private isCovered(from: number, to: number): boolean {
    for (const [f, t] of this.coverage) {
      if (f <= from && t >= to) return true;
      if (f > from) return false; // ranges are sorted; subsequent ones can't cover from
    }
    return false;
  }

  /** Returns the uncovered sub-ranges within [from, to]. */
  private findGaps(from: number, to: number): Range[] {
    const gaps: Range[] = [];
    let cursor = from;
    for (const [f, t] of this.coverage) {
      if (t < cursor) continue;
      if (f > to) break;
      if (f > cursor) gaps.push([cursor, Math.min(f - 1, to)]);
      cursor = Math.max(cursor, t + 1);
      if (cursor > to) break;
    }
    if (cursor <= to) gaps.push([cursor, to]);
    return gaps;
  }

  private alreadyPending(from: number, to: number): boolean {
    for (const [pf, pt] of this.pending.values()) {
      if (pf <= from && pt >= to) return true;
    }
    return false;
  }
}
