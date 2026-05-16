/**
 * Tracks the offset between server timestamps and the client's monotonic
 * clock. Use the median over the last N samples for stability against jitter,
 * which gives a reasonable estimate of "current server time" on the client.
 */
export class ServerClock {
  private offsets: number[] = [];
  private readonly capacity: number;

  constructor(capacity = 32) {
    this.capacity = capacity;
  }

  /** Record the server timestamp at the moment a message was received. */
  observe(serverT: number): void {
    const offset = serverT - Date.now();
    this.offsets.push(offset);
    if (this.offsets.length > this.capacity) this.offsets.shift();
  }

  /** Best-estimate current server time, in ms. Falls back to client clock until first observation. */
  now(): number {
    if (this.offsets.length === 0) return Date.now();
    const sorted = [...this.offsets].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    return Date.now() + median;
  }

  get ready(): boolean {
    return this.offsets.length > 0;
  }
}
