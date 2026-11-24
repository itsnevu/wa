import { seriesColor, type SeriesMap } from '../../lib/chartColors';
import type { Datum } from './types';

export function Legend({ data, hidden, toggle, seriesMap }: {
  data: readonly Datum[]; hidden: ReadonlySet<string>; toggle: (key: string) => void; seriesMap?: SeriesMap;
}) {
  return <div role="group" aria-label="Legenda grafik" className="flex flex-wrap justify-center gap-x-4 gap-y-1">
    {data.map(item => {
      const color = seriesColor(item.key,seriesMap);
      return <button type="button" key={item.key} aria-pressed={!hidden.has(item.key)} onClick={() => toggle(item.key)}
        className={`flex items-center gap-1.5 text-xs text-[var(--text-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] ${!item.value || hidden.has(item.key) ? 'opacity-[.38]' : ''}`}>
        <i aria-hidden="true" className="size-[9px] rounded-[3px]" style={{ background:color.fill, opacity:color.opacity }}/>{item.label}
      </button>;
    })}
  </div>;
}
