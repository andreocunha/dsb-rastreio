export type PublicSos = [id: string, boatId: string, boatName: string, receivedAt: number];

/** Baseline old calls silently; keep IDs through reconnects, removals and retries. */
export class SosNotices {
  private initialized = false;
  private seen = new Set<string>();
  accept(rows: PublicSos[]): PublicSos[] {
    const fresh = rows.filter(row => !this.seen.has(row[0]));
    for (const row of rows) this.seen.add(row[0]);
    // The server sends at most 100 active calls. Bound memory for long-lived tabs.
    while (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
    if (!this.initialized) { this.initialized = true; return []; }
    return fresh.sort((a,b) => a[3]-b[3]);
  }
}
