/** Team logos are served by the DSB app (teams.logo holds the file name). */
// Literal env access is inlined by Next; the guard keeps plain Node/tests working.
export const LOGO_BASE = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_LOGO_BASE) || 'https://dsb.app.br';
export function logoUrl(file?: string | null) {
  return file && /^[a-z0-9-]{1,60}\.(webp|png|jpg|svg)$/.test(file) ? `${LOGO_BASE}/logos/${file}` : undefined;
}
