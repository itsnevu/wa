import { HorizontalRows } from './HorizontalRows';
import type { ChartProps } from './types';

export function ProgressBar(props: ChartProps) {
  return <HorizontalRows empty="Belum ada pelunasan" {...props} mode="progress"/>;
}
