'use client';

import { useId } from 'react';
import { chartTokens, limitedSeriesMap, seriesColor, outcomeColors } from '../../lib/chartColors';
import { ChartEmpty } from './ChartEmpty';
import { DataTable } from './DataTable';
import { Legend } from './Legend';
import { useChart } from './useChart';
import { format, safe, summary, total, type ChartProps } from './types';

const emptyLegend = [
  { key:'lunas', label:'Lunas', value:0 },
  { key:'ditolak', label:'Ditolak', value:0 },
  { key:'tidak_terjawab', label:'Tidak terjawab', value:0 },
  { key:'dp_hangus', label:'DP hangus', value:0 },
];

export function Donut({ data, seriesMap = outcomeColors, empty = 'Belum ada deal selesai', onHover }: ChartProps) {
  const labelId = useId();
  const chart = useChart(onHover);
  const visible = data.filter(item => safe(item.value) > 0 && !chart.hidden.has(item.key));
  const sum = total(visible);
  const small = visible.filter(item => item.value / sum < .03);
  const others = { key:'lainnya', label:'Lainnya', value:total(small), context:summary(small,'') };
  const items = [...visible.filter(item => !small.includes(item)), ...(small.length ? [others] : [])].sort((a,b)=>b.value-a.value);
  const palette = limitedSeriesMap(seriesMap);
  let start = 0;
  const slices = items.map(item => {
    const span = 100 * item.value / sum;
    const middle = (start + span / 2) * Math.PI / 50;
    const gap = items.length === 1 ? 0 : Math.min(span / 2,100 * 2.5 / (2 * Math.PI * 67.5));
    const slice = { item, span, offset:-(start + gap / 2), length:span-gap, middle };
    start += span;
    return slice;
  });
  const active = slices.find(slice => slice.item.key === chart.active?.key);
  return <figure style={chartTokens} className="m-0 grid justify-items-center gap-3">
    <div className="relative w-full max-w-[420px]">
      <svg viewBox="0 0 200 200" aria-hidden="true" className="mx-auto block w-[200px] max-w-full overflow-visible">
        {!sum && <circle cx="100" cy="100" r="67.5" fill="none" stroke="var(--track)" strokeWidth="65" opacity=".6"/>}
        {slices.map(({item,length,offset})=>{
          const color = items.length === 1 ? {fill:'var(--accent)',opacity:1} : seriesColor(item.key,palette);
          return <circle key={item.key} cx="100" cy="100" r="67.5" fill="none" stroke={color.fill}
            opacity={active && active.item.key !== item.key ? color.opacity * .6 : color.opacity}
            strokeWidth={active?.item.key === item.key ? 68 : 65} pathLength="100" transform="rotate(-90 100 100)"
            strokeDasharray={`${length} 100`} strokeDashoffset={offset} strokeLinecap="butt"
            onPointerEnter={chart.bind(item).onMouseEnter} onPointerLeave={chart.bind(item).onMouseLeave}
            style={color.fill === 'var(--c1)' || color.fill === 'var(--accent)' ? {filter:'drop-shadow(0 0 22px var(--chart-glow))'} : undefined}/>;
        })}
      </svg>
      <div role="img" aria-labelledby={labelId} className="sr-only"><span id={labelId}>{summary(visible,empty)}</span></div>
      <div className="pointer-events-none absolute top-1/2 left-1/2 size-[70px] -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[inset_0_2px_8px_var(--chart-shadow)]" />
      {!sum && <ChartEmpty label={empty}/>}
      {active && <div className="pointer-events-none absolute z-10 hidden max-w-[132px] rounded-[10px] border border-[var(--chart-glass-line)] bg-[var(--chart-glass)] px-2.5 py-2 text-[var(--text)] backdrop-blur-[16px] backdrop-saturate-150 min-[380px]:grid [background-image:linear-gradient(var(--chart-scrim-top),var(--chart-scrim-bottom))]"
        style={{top:`clamp(0px, ${100-Math.cos(active.middle)*106}px, 150px)`,[Math.sin(active.middle)>=0?'right':'left']:0}}>
        <strong className={active===slices[0]?'text-lg':'text-[13px]'}>{format.format(active.span)}%</strong>
        <span className="text-xs text-[var(--text-muted)]">{active.item.label}</span>
        {active.item.context && <span className="text-xs text-[var(--text-muted)]">{active.item.context}</span>}
      </div>}
    </div>
    <div className="flex flex-wrap justify-center gap-2">
      {slices.map(({item,span})=><button type="button" key={item.key} {...chart.bind(item)} className="sr-only focus:not-sr-only focus-visible:outline-[var(--accent)]" aria-label={`${item.label} ${format.format(span)}%`}>{item.label}</button>)}
    </div>
    <Legend data={data.length ? data : emptyLegend} hidden={chart.hidden} toggle={chart.toggle} seriesMap={palette}/>
    <DataTable data={data} label="Hasil deal yang sudah selesai"/>
  </figure>;
}

