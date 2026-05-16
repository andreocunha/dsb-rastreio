import type { ServerMessage, PositionUpdate } from './types';

export interface SocketClientCallbacks {
  onUpdates?: (updates: PositionUpdate[]) => void;
  onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void;
}

export interface SocketClientOptions {
  url: string;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

/**
 * Thin WebSocket wrapper with exponential-backoff reconnect. Parses
 * `positions` messages and hands updates to the caller; everything else
 * (interpolation, outlier filter) lives in RealtimeSource.
 */
export function connectRealtime(opts: SocketClientOptions, cb: SocketClientCallbacks): () => void {
  const reconnectMin = opts.reconnectMinMs ?? 500;
  const reconnectMax = opts.reconnectMaxMs ?? 8000;
  let ws: WebSocket | null = null;
  let closed = false;
  let backoff = reconnectMin;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function open() {
    if (closed) return;
    cb.onStatus?.('connecting');
    ws = new WebSocket(opts.url);
    ws.onopen = () => {
      backoff = reconnectMin;
      cb.onStatus?.('open');
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'positions' && Array.isArray(msg.updates)) {
        cb.onUpdates?.(msg.updates);
      }
    };
    ws.onerror = () => cb.onStatus?.('error');
    ws.onclose = () => {
      cb.onStatus?.('closed');
      ws = null;
      if (closed) return;
      reconnectTimer = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, reconnectMax);
    };
  }

  open();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    ws = null;
  };
}
