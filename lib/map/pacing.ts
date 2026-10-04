/**
 * Display refresh period from recent intervals between animation frames: the shortest interval
 * that at least 20% of them (and 4 or more) agree on. A lone odd callback can't fool it, frames a
 * busy GPU skipped (2× or 3× the period) don't hide it, and it follows Android switching 90 ↔ 60 Hz.
 */
export function refreshPeriod(samples: number[], fallback: number) {
  const sorted = [...samples].sort((a, b) => a - b), need = Math.max(4, sorted.length * .2);
  for (const c of sorted) {
    const near = sorted.filter(x => Math.abs(x - c) < 1);
    if (near.length >= need) return near.reduce((a, b) => a + b, 0) / near.length;
  }
  return fallback;
}
