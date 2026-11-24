import { HorizontalRows } from './HorizontalRows';
import type { ChartProps } from './types';

export function BarHorizontal(props: ChartProps) {
  return <HorizontalRows empty="Belum ada alasan drop-off" {...props} mode="rank"/>;
}
