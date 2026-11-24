import { HorizontalRows } from './HorizontalRows';
import type { ChartProps } from './types';

export function Funnel(props: ChartProps) {
  return <HorizontalRows empty="Belum ada deal dalam funnel" {...props} mode="funnel"/>;
}
