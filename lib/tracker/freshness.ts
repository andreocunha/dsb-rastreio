export const LIVE_AGE_MS = 15_000;
export function isRecentPosition(capturedAt: string | undefined, now = Date.now()) {
  const time = Date.parse(capturedAt ?? '');
  return Number.isFinite(time) && now - time >= -5000 && now - time < LIVE_AGE_MS;
}
export function positionAge(capturedAt: string | undefined, now = Date.now()) {
  const time = Date.parse(capturedAt ?? '');
  if (!Number.isFinite(time)) return 'Sem posição';
  const seconds = Math.max(0, Math.floor((now - time) / 1000));
  if (seconds < 60) return `há ${seconds} s`;
  if (seconds < 3600) return `há ${Math.floor(seconds / 60)} min`;
  return `há ${Math.floor(seconds / 3600)} h`;
}
export function feedStatusFor(
  phase: 'connecting' | 'connected' | 'disconnected',
  healthy: boolean,
  boats: { capturedAt: string }[],
  now = Date.now(),
) {
  if (phase === 'connecting') return 'Conectando ao rastreamento…';
  if (phase === 'disconnected') return 'Conexão indisponível · Reconectando';
  if (!healthy) return 'Servidor sem atualização · Últimas posições';
  if (!boats.length) return 'Aguardando barcos iniciarem a viagem';
  const fresh = boats.filter(boat => isRecentPosition(boat.capturedAt, now)).length;
  if (fresh === boats.length) return 'Ao vivo';
  if (fresh) return `Ao vivo · ${boats.length - fresh} sem atualização`;
  const latest = boats.reduce((a, b) => Date.parse(b.capturedAt) > Date.parse(a.capturedAt) ? b : a);
  return `Sem sinal dos trackers · Última posição ${positionAge(latest.capturedAt, now)}`;
}
