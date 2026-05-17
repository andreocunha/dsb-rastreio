import type { ServerMessage, PositionUpdate, InitMessage, HistoryMessage } from './types';

export interface SocketClientCallbacks {
  onInit?: (msg: InitMessage) => void;
  onUpdates?: (updates: PositionUpdate[]) => void;
  onHistory?: (msg: HistoryMessage) => void;
  onStatus?: (status: 'connecting' | 'open' | 'closed' | 'error') => void;
}

export interface SocketClientOptions {
  url: string;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
}

export interface SocketClient {
  disconnect: () => void;
  /** Send a getHistory request. No-op if the socket isn't open. */
  requestHistory: (from: number, to: number, reqId: string) => void;
}

/**
 * Thin WebSocket wrapper with exponential-backoff reconnect. Parses server
 * messages and routes them to typed callbacks; everything else (history
 * merging, coverage tracking) is RealtimeSource's job.
 */
export function connectRealtime(opts: SocketClientOptions, cb: SocketClientCallbacks): SocketClient {
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
      if (msg.type === 'init') cb.onInit?.(msg);
      else if (msg.type === 'positions' && Array.isArray(msg.updates)) cb.onUpdates?.(msg.updates);
      else if (msg.type === 'history') cb.onHistory?.(msg);
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

  return {
    disconnect() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
      ws = null;
    },
    requestHistory(from, to, reqId) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'getHistory', reqId, from, to }));
      }
    },
  };
}
