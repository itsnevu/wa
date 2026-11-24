import type { SeriesMap } from '../../lib/chartColors';

export type Datum = { key: string; label: string; value: number; context?: string };
export type ChartProps = {
  data: readonly Datum[];
  seriesMap?: SeriesMap;
  empty?: string;
  onHover?: (datum: Datum | null) => void;
};
export const format = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });
export const safe = (value: number) => Number.isFinite(value) ? Math.max(0,value) : 0;
export const total = (data: readonly Datum[]) => data.reduce((sum, item) => sum + safe(item.value), 0);
export const summary = (data: readonly Datum[], empty: string) =>
  total(data) ? data.map(item => `${item.label}: ${format.format(safe(item.value))}`).join(', ') : empty;
