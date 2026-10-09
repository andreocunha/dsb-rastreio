/**
 * Boat colours on the map (teams.map_color). Spread around the colour wheel so a fleet of a
 * dozen boats stays distinguishable on dark water; teams.color is the DSB app's badge colour.
 */
export const TEAM_COLORS: {hex: string; label: string}[] = [
  {hex: '#ff4d4f', label: 'Vermelho'},
  {hex: '#ff7a1f', label: 'Laranja'},
  {hex: '#ffb020', label: 'Âmbar'},
  {hex: '#ffd60a', label: 'Amarelo'},
  {hex: '#a6e22e', label: 'Verde-limão'},
  {hex: '#2fbf5a', label: 'Verde'},
  {hex: '#1fc7b6', label: 'Turquesa'},
  {hex: '#45b6ff', label: 'Azul-céu'},
  {hex: '#3a78ff', label: 'Azul'},
  {hex: '#9b6bff', label: 'Roxo'},
  {hex: '#e14bd8', label: 'Magenta'},
  {hex: '#ff7eb6', label: 'Rosa'},
  {hex: '#c8894a', label: 'Bronze'},
  {hex: '#e3e8ec', label: 'Prata'},
];
/** Badge colours of the DSB app, used until a team has its own map colour. */
const APP_COLORS: Record<string, string> = {blue: '#2f86ff', purple: '#a371ff', green: '#7bd63a', orange: '#ff7a1f', red: '#ff4d4f', yellow: '#ffc629', gold: '#ffc629', cyan: '#41d6f5'};

export const isTeamColor = (value: unknown): value is string => TEAM_COLORS.some(c => c.hex === value);
/** Hex for a map colour or an app colour name; blue when unknown. */
export function teamColor(value?: string | null): string {
  if (value && /^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  return APP_COLORS[value ?? ''] ?? APP_COLORS.blue;
}
