/**
 * Adapts the 3D view to the phone it runs on. Weak GPUs are limited by the pixels they shade,
 * so resolution goes first; half frame rate is the last resort.
 *
 * Each situation learns its own resolution: while someone drags the map it has to keep up with
 * the display, but most of the race is watched hands-off in eco mode (30 fps), where even a weak
 * phone can afford a sharp picture. The levels that worked are remembered, so a phone opens at
 * them next time instead of stuttering (or looking blurry) for the first seconds.
 *
 * Input: how long each rendered frame took compared to the interval the engine asked for.
 */
export type BudgetMode = 'full' | 'half' | 'eco';
type Level = { scale: number; late: number; changedAt: number; raisedAt: number; raiseWait: number };

export class FrameBudget {
  /** Interactive frames at half the display-paced rate (60→30, 90→45) while even the lowest resolution can't keep up. */
  halfRate = false;
  private mode: BudgetMode = 'eco';
  private levels: Record<BudgetMode, Level>;
  private droppedAt = 0;
  private retryAfter = 20000;

  /**
   * @param minScale resolution floor (keeps at least one framebuffer pixel per CSS pixel)
   * @param initial first-visit resolution while interacting, before anything was learnt on this phone
   * @param initialEco same while watching (30 fps leaves more room)
   */
  constructor(private minScale: number, private store?: Storage | null, private key = 'dsb:map:quality-v3', initial = 1, initialEco = initial) {
    const level = (scale: number): Level => ({scale: Math.max(minScale, Math.min(1, scale)), late: 1, changedAt: 0, raisedAt: -Infinity, raiseWait: 4000});
    this.levels = {full: level(initial), half: level(initial), eco: level(initialEco)};
    try {
      const saved = JSON.parse(store?.getItem(key) ?? 'null') as Partial<Record<BudgetMode, number>> & {halfRate?: boolean} | null;
      for (const mode of ['full', 'half', 'eco'] as const) if (Number(saved?.[mode]) > 0) this.levels[mode] = level(Number(saved![mode]));
      // Known to need half rate: start there (the full rate is retried later, as usual).
      if (saved?.halfRate) this.halfRate = true;
    } catch { /* storage unavailable or unreadable: start from the defaults */ }
  }

  /** Fraction of the device's full 3D resolution for the current situation, 1 = full. */
  get scale() { return this.levels[this.mode].scale; }

  setFloor(minScale: number) { this.minScale = minScale; for (const l of Object.values(this.levels)) l.scale = Math.max(minScale, l.scale); }

  /**
   * One rendered frame. Returns true when the resolution to render at changed.
   * @param elapsed ms since the previous rendered frame
   * @param target ms the engine meant between frames
   * @param interactive full rate was requested (touch, camera move)
   * @param gpuBehind the GPU had not finished the previous frame when this one began: the page's
   *   own timing looks fine then (the browser queues frames), but they reach the screen irregularly
   */
  frame(elapsed: number, target: number, interactive: boolean, now: number, gpuBehind = false) {
    const mode: BudgetMode = interactive ? (this.halfRate ? 'half' : 'full') : 'eco';
    if (mode !== this.mode) {
      // A new situation: its first intervals reflect the switch, not the GPU.
      const before = this.scale; this.mode = mode;
      const l = this.levels[mode]; l.late = 1; l.changedAt = Math.max(l.changedAt, now - 600);
      return this.scale !== before;
    }
    const l = this.levels[mode];
    // Just after a resolution change the GPU reallocates its buffers: those frames say nothing.
    if (now - l.changedAt < 1000) return false;
    // A little slack for timer and vsync jitter; e.g. ~46 fps on average when 60 was asked is "late".
    // While watching, a late frame is the processor (a hot phone, garbage collection) or the page's
    // own timer slipping a refresh: a lower resolution wouldn't help, only blur the picture. There
    // only the GPU's own signal decides.
    const timing = mode === 'eco' ? 1 : elapsed / (target + 2);
    l.late += (Math.min(4, Math.max(timing, gpuBehind ? 1.5 : 0)) - l.late) * .08;
    if (now - l.changedAt < 1200) return false;
    // Watching (eco) is held to a stricter standard: a late frame there is a boat visibly jerking, and
    // a sharper picture than the phone comfortably affords only heats it up over a three-hour race.
    const [tooLate, roomy] = mode === 'eco' ? [1.06, 1.015] : [1.15, 1.04];
    if (l.late > tooLate) {
      const late = l.late;
      l.changedAt = now; l.late = 1;
      // Dropped soon after a raise: that level is too much, wait longer before trying it again.
      if (now - l.raisedAt < 6000) l.raiseWait = Math.min(120000, l.raiseWait * 2);
      // Far behind (a weak phone at full resolution): two steps at once, it settles in seconds.
      if (l.scale > this.minScale + .001) { l.scale = Math.max(this.minScale, l.scale * (late > 1.6 ? .72 : .85)); this.save(); return true; }
      if (mode === 'full') {
        this.halfRate = true; this.droppedAt = now; this.retryAfter = Math.min(300000, this.retryAfter * 2);
        // Half rate starts no sharper than what just failed at full rate.
        this.levels.half.scale = Math.min(this.levels.half.scale, l.scale); this.save();
      }
      return false;
    }
    // The full rate is retried while someone drags the map: only then does it matter.
    if (this.halfRate && mode === 'half' && now - this.droppedAt > this.retryAfter) { this.halfRate = false; this.droppedAt = now; this.save(); return false; }
    // Headroom: try a sharper picture, one step at a time.
    if (l.late < roomy && l.scale < 1 && now - l.changedAt > l.raiseWait) {
      l.scale = Math.min(1, l.scale / .85); l.changedAt = l.raisedAt = now; this.save(); return true;
    }
    return false;
  }

  /** Diagnostics: current situation and how late its frames run. */
  get state() { const l = this.levels[this.mode]; return `${this.mode}:${l.late.toFixed(2)}`; }

  /** The clock restarts (tab shown again): the first interval says nothing about the GPU. */
  reset() { this.levels[this.mode].late = 1; }

  private save() {
    try { this.store?.setItem(this.key, JSON.stringify({full: +this.levels.full.scale.toFixed(3), half: +this.levels.half.scale.toFixed(3), eco: +this.levels.eco.scale.toFixed(3), halfRate: this.halfRate})); }
    catch { /* quota or privacy mode */ }
  }
}

/**
 * Entry-level mobile GPUs (few shader cores) that can't shade a phone screen at 60 fps with the
 * water effects: they start at a lower resolution instead of stuttering while the budget adapts.
 * Only a starting point: the budget raises it again when there is headroom.
 * @param renderer unmasked WebGL renderer, e.g. "ANGLE (ARM, Mali-G52 MC2, OpenGL ES 3.2)"
 */
export function weakGpu(renderer: string) {
  const mali = /Mali-(G\d+|T\d+|\d+)(?:\s*M[CP](\d+))?/i.exec(renderer);
  if (mali) {
    const [model, cores] = [mali[1].toUpperCase(), Number(mali[2] || 0)];
    if (!model.startsWith('G')) return true;
    return Number(model.slice(1)) < 100 && cores > 0 && cores <= 3;
  }
  const adreno = /Adreno.*?(\d{3})/i.exec(renderer);
  if (adreno) { const n = Number(adreno[1]); return n < 600 || [610, 612, 613].includes(n); }
  return /PowerVR|IMG BX/i.test(renderer);
}
