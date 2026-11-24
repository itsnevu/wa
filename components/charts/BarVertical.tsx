'use client';

import { useId } from 'react';
import { chartTokens } from '../../lib/chartColors';
import { ChartEmpty } from './ChartEmpty';
import { DataTable } from './DataTable';
import { Tooltip } from './Tooltip';
import { useChart } from './useChart';
import { format, safe, summary, type ChartProps } from './types';

export function BarVertical({ data, seriesMap, empty = 'Belum ada deal lunas di periode ini', onHover }: ChartProps) {
  const id = useId();
  const chart = useChart(onHover);
  const max = Math.max(0,...data.map(item=>safe(item.value)));
  const tick = Math.max(1,Math.ceil(max/5));
  const rows = data.length ? data : Array.from({length:7},(_,index)=>({key:String(index),label:['Sen','Sel','Rab','Kam','Jum','Sab','Min'][index],value:0}));
  const column = 371/rows.length;
  return <figure style={chartTokens} className="relative m-0">
    <div role="img" aria-label={summary(data,empty)} className="sr-only" />
    <svg viewBox="0 0 410 186" className="block w-full overflow-visible">
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop stopColor="var(--accent)"/><stop offset="1" stopColor="var(--chart-bar-end)"/></linearGradient></defs>
      {[5,4,3,2,1].map(level=><g key={level} aria-hidden="true"><line x1="38" x2="409" y1={160-level*29} y2={160-level*29} stroke="var(--chart-grid)" strokeDasharray="3 3"/><text x="32" y={164-level*29} textAnchor="end" fill="var(--text-muted)" fontSize="11">{format.format(tick*level)}</text></g>)}
      {rows.map((item,index)=>{
        const height = Math.max(9,safe(item.value)*145/(tick*5));
        const selected = chart.active?.key === item.key;
        const width = Math.min(selected ? 20 : 18,column*.85);
        const center = 38+column*(index+.5);
        return <g key={item.key} {...(item.value ? chart.bind(item) : {})} aria-label={`${item.label}: ${item.value}`}>
          <rect x={center-width/2} y={160-height} width={width} height={height} rx={width/2} fill={item.value ? `url(#${id})` : 'var(--chart-placeholder)'}
            opacity={item.value && height <= 9 ? .45 : 1} style={selected && height > 9 ? {filter:'drop-shadow(0 0 22px var(--chart-glow))'} : undefined}/>
          <text x={center} y="181" textAnchor="middle" fill="var(--text-muted)" fontSize="12">{item.label}</text>
        </g>;
      })}
    </svg>
    {!max && <ChartEmpty label={empty}/>}
    {chart.active && <Tooltip item={chart.active} seriesMap={seriesMap}/>}
    <DataTable data={data} label="Deal lunas per minggu"/>
  </figure>;
}
