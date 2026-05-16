export interface PositionUpdate {
  id: string;
  lat: number;
  lon: number;
  t: number;
}

export interface PositionsMessage {
  type: 'positions';
  updates: PositionUpdate[];
}

export type ServerMessage = PositionsMessage;

export interface InterpSample {
  lat: number;
  lon: number;
  /** Bearing of the segment we sampled, in degrees. Null if undefined (single sample). */
  bearing: number | null;
  /** Estimated speed at this point in m/s, from the segment that produced it. */
  speedMps: number;
  /**
   * True when the position did NOT come from a smooth interpolation between
   * two real samples — i.e., the buffer is in warmup (fewer than 2 useful
   * samples), the requested time is before the buffer starts, or beyond the
   * latest sample (capped extrapolation). The engine treats this as "stale"
   * for the purpose of pausing the trail.
   */
  extrapolating: boolean;
}
