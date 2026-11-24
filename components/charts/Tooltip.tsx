import { seriesColor, type SeriesMap } from '../../lib/chartColors';
import { format, type Datum } from './types';

export function Tooltip({ item, seriesMap }: { item: Datum; seriesMap?: SeriesMap }) {
  return <div role="tooltip" className="pointer-events-none absolute top-1 right-1 z-10 max-w-[132px] rounded-lg border border-[var(--chart-glass-line)] bg-[var(--chart-glass)] px-2.5 py-2 text-xs text-[var(--text)] backdrop-blur-[14px] backdrop-saturate-150 shadow-[0_12px_32px_-8px_var(--chart-shadow)] [background-image:linear-gradient(var(--chart-scrim-top),var(--chart-scrim-bottom))] after:absolute after:top-3 after:-left-[4px] after:size-[7px] after:rotate-45 after:bg-inherit motion-reduce:transition-none">
    <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]"><i aria-hidden="true" className="size-1.5 rounded-full" style={{ background:seriesColor(item.key,seriesMap).fill }} />{item.label}</div>
    <strong className="text-[13px] font-semibold tabular-nums">{format.format(item.value)}</strong>
    {item.context && <div className="mt-1.5 border-t border-[var(--chart-placeholder)] pt-1.5 text-[11px] text-[var(--text-muted)]">{item.context}</div>}
  </div>;
}
