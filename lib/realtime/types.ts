export interface PositionUpdate {
  id: string;
  lat: number;
  lon: number;
  t: number;
}

/** Live broadcast — push of the latest positions. */
export interface PositionsMessage {
  type: 'positions';
  updates: PositionUpdate[];
}

/** Sent once on connect: race metadata + recent tail so live can start immediately. */
export interface InitMessage {
  type: 'init';
  /** Server time of the first sample of the race. 0 means race hasn't started. */
  raceStartT: number;
  /** Server time at the moment the message was assembled. */
  serverT: number;
  /** Recent samples across all boats (last ~30s) so smoother has data right away. */
  tail: PositionUpdate[];
}

/** Server's response to a client `getHistory` request. */
export interface HistoryMessage {
  type: 'history';
  reqId: string | null;
  /** Echoed request range (closed interval). */
  from: number;
  to: number;
  samples: PositionUpdate[];
}

export type ServerMessage = PositionsMessage | InitMessage | HistoryMessage;

/** Client → server: request all samples whose t is in [from, to]. */
export interface GetHistoryRequest {
  type: 'getHistory';
  reqId: string;
  from: number;
  to: number;
}

export interface InterpSample {
  lat: number;
  lon: number;
  /** Bearing of the segment we sampled, in degrees. Null when displacement was too small to trust. */
  bearing: number | null;
  /** Estimated speed at this point in m/s. */
  speedMps: number;
  /**
   * True when the position did NOT come from a smooth interpolation between
   * two real samples (warmup, clamp before buffer, beyond latest sample).
   */
  extrapolating: boolean;
}
