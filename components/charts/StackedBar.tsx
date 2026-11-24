'use client';

import { chartTokens, limitedSeriesMap, seriesColor, type SeriesMap } from '../../lib/chartColors';
import { ChartEmpty } from './ChartEmpty';
import { DataTable } from './DataTable';
import { Legend } from './Legend';
import { Tooltip } from './Tooltip';
import { useChart } from './useChart';
import { format, safe, summary, total, type ChartProps } from './types';

const runningColors: SeriesMap = {dp_aktif:'c4',menunggu_bukti:'c6',menunggu_verifikasi:'track'};
const emptyLegend = [
  {key:'dp_aktif',label:'DP aktif',value:0},
  {key:'menunggu_bukti',label:'Menunggu bukti',value:0},
  {key:'menunggu_verifikasi',label:'Menunggu verifikasi tim',value:0},
];

export function StackedBar({ data, seriesMap = runningColors, empty = 'Belum ada deal berjalan', onHover }: ChartProps) {
  const chart = useChart(onHover);
  const visible = data.filter(item=>safe(item.value)>0 && !chart.hidden.has(item.key));
  const sum = total(visible);
  const small = visible.filter(item=>item.value/sum<.03);
  const rows = [...visible.filter(item=>!small.includes(item)),...(small.length?[{key:'lainnya',label:'Lainnya',value:total(small),context:summary(small,'')}]:[])];
  const palette = limitedSeriesMap(seriesMap);
  let x = 0;
  return <figure style={chartTokens} className="m-0 grid gap-3">
    <div role="img" aria-label={summary(visible,empty)} className="sr-only"/>
    <div className="relative min-h-[22px]">
      <svg width="100%" height="22" className="block overflow-hidden rounded-[11px]">
        {!sum && <rect width="100%" height="22" fill="var(--track)"/>}
        {rows.map((item,index)=>{
          const share = 100*item.value/sum;
          const left = x;
          x += share;
          const color = seriesColor(item.key,palette);
          return <g key={item.key} {...chart.bind(item)} aria-label={`${item.label}, ${format.format(share)}%`}>
            <rect x={`${left}%`} style={{width:index===rows.length-1?`${share}%`:`max(0px, calc(${share}% - 2px))`}} height="22" fill={color.fill} opacity={color.opacity}/>
            {share>14 && <text x={`${left+share/2}%`} y="15" textAnchor="middle" fontSize="11" fontWeight="600" fill={color.fill==='var(--track)'?'var(--text)':'var(--accent-ink)'}>{format.format(share)}%</text>}
          </g>;
        })}
      </svg>
      {!sum && <ChartEmpty label={empty}/>}
      {chart.active && <Tooltip item={chart.active} seriesMap={seriesMap}/>}
    </div>
    <Legend data={data.length ? data : emptyLegend} seriesMap={palette} hidden={chart.hidden} toggle={chart.toggle}/>
    <DataTable data={data} label="Deal yang masih berjalan"/>
  </figure>;
}

