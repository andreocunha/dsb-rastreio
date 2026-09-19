import type { CSSProperties } from 'react';
type Name = 'sun' | 'waves' | 'layers' | 'target' | 'plus' | 'minus' | 'chevron' | 'close' | 'settings' | 'boat' | 'pause' | 'play' | 'check' | 'offline' | 'buoy' | 'route' | 'flag' | 'tool' | 'arrow' | 'info';
const paths: Record<Name, React.ReactNode> = {
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>,
  waves: <path d="M2 8c3-5 5 5 10 0s7 4 10 0M2 14c3-5 5 5 10 0s7 4 10 0M2 20c3-5 5 5 10 0s7 4 10 0"/>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/></>,
  target: <><circle cx="12" cy="12" r="6"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/><circle cx="12" cy="12" r="1"/></>,
  plus: <path d="M12 5v14M5 12h14"/>, minus: <path d="M5 12h14"/>,
  chevron: <path d="m8 5 7 7-7 7"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
  settings: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
  boat: <><path d="m12 3 6 7-2 10H8L6 10l6-7Z"/><path d="M9 10h6v6H9zm3 0v6M9 13h6"/></>,
  pause: <><path d="M8 5v14M16 5v14"/></>, play: <path d="m8 4 12 8-12 8V4Z"/>,
  check: <path d="m5 12 4 4L19 6"/>, offline: <><path d="m3 3 18 18M5 9c4-4 10-4 14 0M8 13c3-3 5-3 8 0"/><circle cx="12" cy="18" r="1"/></>,
  buoy: <><path d="M12 3v11l7-7-7-4Z"/><ellipse cx="12" cy="18" rx="6" ry="3"/></>,
  route: <><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/><path d="M5 16V8a4 4 0 0 1 8 0v8a3 3 0 0 0 6 0V8"/></>,
  flag: <><path d="M5 21V3m0 0c6-4 8 4 14 0v10c-6 4-8-4-14 0"/><path d="M12 3v10M5 8h14"/></>,
  tool: <path d="m14 5 5 5M4 20l5-1 11-11-4-4L5 15l-1 5Z"/>,
  arrow: <path d="M12 20V4m-6 6 6-6 6 6"/>,
};
export function Icon({ name, size = 20, style }: {name: Name; size?: number; style?: CSSProperties}) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
