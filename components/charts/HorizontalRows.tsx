'use client';

import { chartTokens } from '../../lib/chartColors';
import { ChartEmpty } from './ChartEmpty';
import { DataTable } from './DataTable';
import { Tooltip } from './Tooltip';
import { useChart } from './useChart';
import { format, safe, summary, total, type ChartProps } from './types';

export function HorizontalRows({ data, empty = 'Belum ada data', seriesMap, onHover, mode }: ChartProps & { mode:'funnel'|'rank'|'progress' }) {
  const chart = useChart(onHover);
  const rows = mode === 'rank' ? [...data].sort((a,b)=>safe(b.value)-safe(a.value)) : data;
  const emptyLabels = mode === 'funnel' ? ['Inquiry','Qualified','Kandidat','Bukti / DP','Lunas']
    : mode === 'progress' ? ['Langsung lunas','Lewat DP dulu'] : [''];
  const items = rows.length ? rows : emptyLabels.map((label,index)=>({key:String(index),label,value:0}));
  const denominator = mode === 'funnel' ? safe(items[0].value) : mode === 'progress' ? total(rows) : Math.max(0,...rows.map(item=>safe(item.value)));
  return <figure style={chartTokens} className="relative m-0 grid gap-2">
    <div role="img" aria-label={summary(rows,empty)} className="sr-only" />
    {items.map((item,index)=>{
      const value = safe(item.value);
      const ratio = denominator ? Math.min(1,value/denominator) : 0;
      const height = mode === 'funnel' ? 18 : 14;
      const previous = index ? safe(items[index-1].value) : 0;
      return <div key={item.key} className="grid gap-2">
        {mode === 'funnel' && index > 0 && previous > 0 && <span className="text-center text-[10px] text-[var(--text-muted)]">↓ {format.format(value/previous*100)}%</span>}
        <div className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-center gap-2 text-xs" {...(value ? chart.bind(item) : {})}>
          <span className="truncate text-[var(--text-muted)]" title={item.label}>{item.label}</span>
          <svg aria-hidden="true" width="100%" height={height}>
            <rect width="100%" height={height} rx={height/2} fill="var(--track)"/>
            {!!ratio && <rect width={`${ratio*100}%`} height={height} rx={height/2} fill="var(--accent)" opacity={mode==='progress'?1:1-index/Math.max(1,items.length-1)*(mode==='funnel'?.55:.45)}
              style={mode==='rank' && !index ? {filter:'drop-shadow(0 0 6px var(--chart-glow))'} : undefined}/>}
          </svg>
          <span className="tabular-nums text-[var(--text)]">{format.format(mode==='progress'?ratio*100:value)}{mode==='progress'?'%':''}</span>
        </div>
      </div>;
    })}
    {!denominator && <ChartEmpty label={empty}/>}
    {chart.active && <Tooltip item={chart.active} seriesMap={seriesMap}/>}
    <DataTable data={rows} label={mode==='rank'?'Alasan drop-off':mode==='progress'?'Cara pelanggan melunasi':'Funnel'}/>
  </figure>;
}
