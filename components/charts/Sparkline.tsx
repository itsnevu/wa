'use client';

import { useId } from 'react';
import { chartTokens } from '../../lib/chartColors';
import { ChartEmpty } from './ChartEmpty';
import { DataTable } from './DataTable';
import { Tooltip } from './Tooltip';
import { useChart } from './useChart';
import { safe, summary, type ChartProps } from './types';

export function Sparkline({ data, seriesMap, empty = 'Belum ada tren', onHover }: ChartProps) {
  const id = useId();
  const chart = useChart(onHover);
  const values = data.map(item=>safe(item.value));
  const max = Math.max(0,...values), min = Math.min(...values,max);
  const down = values.length>1 && values[values.length-1]<values[0];
  const color = down?'var(--danger)':'var(--accent)';
  const points = data.map((_,index)=>[data.length===1?100:index*200/(data.length-1),max===min?14:24-20*(values[index]-min)/(max-min)]);
  return <figure style={chartTokens} className="relative m-0">
    <div role="img" aria-label={summary(data,empty)} className="sr-only"/>
    <svg viewBox="0 0 200 28" width="100%" height="28" preserveAspectRatio="none">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop stopColor={down?'var(--chart-danger-area)':'var(--chart-area)'}/><stop offset="1" stopColor={color} stopOpacity="0"/></linearGradient></defs>
      {max>0 && points.length>1 && <polygon points={`0,28 ${points.map(point=>point.join(',')).join(' ')} 200,28`} fill={`url(#${id})`}/>}
      <polyline points={max>0 && points.length>1?points.map(point=>point.join(',')).join(' '):'0,14 200,14'} fill="none" stroke={max?color:'var(--chart-placeholder)'} strokeWidth="1.5" vectorEffect="non-scaling-stroke"/>
      {max>0 && points.map(([x],index)=><rect key={data[index].key} x={Math.max(0,x-200/(data.length*2))} width={200/data.length} height="28" fill="transparent" {...chart.bind(data[index])} aria-label={`${data[index].label}: ${values[index]}`}/>)}
    </svg>
    {!max && <ChartEmpty label={empty}/>}
    {chart.active && <Tooltip item={chart.active} seriesMap={seriesMap}/>}
    <DataTable data={data} label="Tren KPI"/>
  </figure>;
}
