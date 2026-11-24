import type { CSSProperties } from 'react';

export const chartTokens: CSSProperties & Record<`--${string}`, string> = {
  '--canvas':'#0B0C0E', '--surface':'#15171A', '--surface-hover':'#1D2024',
  '--border':'rgba(255,255,255,.07)', '--border-strong':'rgba(255,255,255,.13)',
  '--text':'#EDEFF2', '--text-muted':'#9BA1A9', '--text-dim':'#6B7178',
  '--accent':'#F5A524', '--accent-soft':'rgba(245,165,36,.14)', '--accent-ink':'#1A1200',
  '--success':'#3DD68C', '--danger':'#F2555A', '--warning':'#F5C542', '--info':'#4EA8F5',
  '--c1':'#F5A524', '--c2':'#5B8DEF', '--c3':'#3DD68C', '--c4':'#B57BFF',
  '--c5':'#F2555A', '--c6':'#4EA8F5', '--track':'#2A2E33',
  '--chart-placeholder':'rgba(255,255,255,.10)', '--chart-grid':'rgba(255,255,255,.08)',
  '--chart-bar-end':'#8A4E14', '--chart-glow':'rgba(245,165,36,.28)',
  '--chart-area':'rgba(245,165,36,.16)', '--chart-danger-area':'rgba(242,85,90,.14)',
  '--chart-glass':'rgba(24,20,14,.46)', '--chart-glass-line':'rgba(255,255,255,.16)',
  '--chart-glass-highlight':'rgba(255,255,255,.20)', '--chart-scrim-top':'rgba(0,0,0,.10)',
  '--chart-scrim-bottom':'rgba(0,0,0,.28)', '--chart-shadow':'rgba(0,0,0,.55)',
} as const;

export type SeriesColor = 'c1' | 'c2' | 'c3' | 'c4' | 'c5' | 'c6' | 'track';
export type SeriesMap = Readonly<Record<string, SeriesColor>>;
export const outcomeColors: SeriesMap = {
  lunas:'c1', ditolak:'c2', tidak_terjawab:'track', dp_hangus:'c1', lainnya:'track',
};
export function seriesColor(key: string, map: SeriesMap = outcomeColors) {
  return { fill: `var(--${map[key] ?? 'track'})`, opacity: key === 'dp_hangus' ? .4 : 1 };
}

export function limitedSeriesMap(map: SeriesMap): SeriesMap {
  const ramp = new Set([...new Set(Object.values(map).filter(color => color !== 'track'))].sort().slice(0,3));
  return Object.fromEntries(Object.entries(map).map(([key,color]) => [
    key, color !== 'track' && ramp.has(color) ? color : 'track',
  ]));
}
