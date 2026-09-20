/** Visual scale in knots: ignore near-stationary drift and reach full wake at sprint speed. */
const STILL_SPEED = 0.3;
const FULL_WAKE_SPEED = 12;

export function drawWake(ctx: CanvasRenderingContext2D, speed: number, time: number): void {
  if (!Number.isFinite(speed) || speed <= STILL_SPEED) return;
  // A fast support craft must not change the scale used by solar competitors.
  const intensity = Math.min(1, (speed - STILL_SPEED) / (FULL_WAKE_SPEED - STILL_SPEED));
  for (let i = 0; i < 5; i++) {
    const phase = (time / 1700 + i / 5) % 1;
    const y = 17 + phase * 54 * intensity;
    const w = 1 + phase * 16 * intensity;
    ctx.beginPath();
    ctx.moveTo(-w, y + 3);
    ctx.quadraticCurveTo(0, y - 2, w, y + 3);
    ctx.strokeStyle = `rgba(236,255,247,${(1 - phase) * 0.5 * intensity})`;
    ctx.lineWidth = (1.4 * (1 - phase) + 0.3) * (0.5 + 0.5 * intensity);
    ctx.stroke();
  }
}
