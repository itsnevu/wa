import { useId, useState } from 'react';

const periods = [4, 12, 26];
const days = ['Jum', 'Sab', 'Min', 'Sen', 'Sel', 'Rab', 'Kam'];
const demo = {
  4: [950000, 2050000, 3290000, 1720000, 4160000, 95000, 75000],
  12: [1450000, 2580000, 3740000, 2020000, 4987000, 130000, 85000],
  26: [1700000, 2920000, 4470000, 2340000, 4750000, 145000, 95000],
};
const demoDates = ['8 Agu 2025', '9 Agu 2025', '10 Agu 2025', '11 Agu 2025', '12 Agu 2025', '13 Agu 2025', '14 Agu 2025'];
const number = new Intl.NumberFormat('id-ID');
const palette = {
  '--canvas': '#111111', '--card': '#1B1B1B', '--text': '#F2F2F2',
  '--border': 'rgba(255,255,255,.07)', '--top-border': 'rgba(255,255,255,.10)',
  '--pill': '#2B2B2B', '--pill-active': '#4A4A4A', '--pill-muted': '#8A8A8A',
  '--positive-bg': 'rgba(95,179,122,.14)', '--positive-text': '#6FBF8A',
  '--grid': 'rgba(255,255,255,.08)', '--axis-y': '#6E6E6E', '--axis-x': '#7A7A7A',
  '--bar': 'linear-gradient(to bottom,#F0B85C,#6B3E12)',
  '--bar-active': 'linear-gradient(to bottom,#FFD07A,#8A4E14)',
  '--bar-glow': 'rgba(233,161,59,.45)', '--placeholder': 'rgba(255,255,255,.10)',
  '--tip': '#2C2C2C', '--tip-border': 'rgba(255,255,255,.06)',
  '--tip-shadow': 'rgba(0,0,0,.5)', '--tip-date': '#9A9A9A', '--accent': '#E9A13B',
};

export default function PaidDealsBarChart({ series = demo, dates = demoDates, delta = '+4.2%' }) {
  const id = useId();
  const [period, setPeriod] = useState(12);
  const values = days.map((_, index) => {
    const value = Number(series[period]?.[index]);
    return Number.isFinite(value) && value > 0 ? value : 0;
  });
  const peak = Math.max(...values);
  const active = values.indexOf(peak);
  const step = Math.max(1, Math.ceil(peak / 5_000_000));
  const ceiling = step * 5_000_000;

  return (
    <div className="grid min-h-[320px] min-w-[512px] place-items-center bg-[var(--canvas)]" style={palette}>
      <section aria-labelledby={id} className="box-border h-[280px] w-[512px] rounded-[14px] border border-[var(--border)] border-t-[var(--top-border)] bg-[var(--card)] px-5 py-[18px]">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h2 id={id} className="m-0 whitespace-nowrap text-[21px] leading-7 font-light tracking-[-.01em] text-[var(--text)]">Deal lunas per minggu</h2>
            {peak > 0 && delta && <span className="rounded-full bg-[var(--positive-bg)] px-2 py-[3px] text-[11px] leading-tight font-medium text-[var(--positive-text)]">{delta}</span>}
          </div>
          <div role="group" aria-label="Periode" className="flex rounded-full bg-[var(--pill)] p-[3px]">
            {periods.map(weeks => (
              <button key={weeks} type="button" aria-pressed={period === weeks} onClick={() => setPeriod(weeks)}
                className="cursor-pointer whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] leading-tight text-[var(--pill-muted)] aria-pressed:bg-[var(--pill-active)] aria-pressed:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]">
                {weeks} mgg
              </button>
            ))}
          </div>
        </header>
        <div className="relative mt-[14px] h-[190px] pl-7 pb-6">
          <div className="relative h-full" role="img" aria-label={peak ? days.map((day, index) => `${day} Rp ${number.format(values[index])}`).join(', ') : 'Belum ada deal lunas di periode ini'}>
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
              {[0, 20, 40, 60, 80].map(y => (
                <line key={y} x1="0" y1={`${y}%`} x2="100%" y2={`${y}%`} stroke="var(--grid)" strokeDasharray="3 3" />
              ))}
            </svg>
            {[5, 4, 3, 2, 1].map((tick, index) => (
              <span key={tick} aria-hidden="true" className="absolute right-[calc(100%+6px)] -translate-y-1/2 text-right text-[11px] leading-none text-[var(--axis-y)]" style={{ top: `${index * 20}%` }}>{tick * step}k</span>
            ))}
            <div aria-hidden="true" className="relative mx-auto grid h-full w-[392px] grid-cols-7">
              {values.map((value, index) => {
                const selected = peak > 0 && index === active;
                const small = value / ceiling < .055;
                const height = `max(9px, ${100 * value / ceiling}%)`;
                return (
                  <div key={days[index]} className="relative">
                    <div className="absolute bottom-0 left-1/2 -translate-x-1/2 rounded-full"
                      style={{ height, width: selected ? 20 : 18,
                        background: !peak || !value ? 'var(--placeholder)' : selected ? 'var(--bar-active)' : 'var(--bar)',
                        opacity: small && value ? .45 : 1,
                        boxShadow: selected && !small ? '0 0 30px var(--bar-glow)' : undefined }} />
                    {selected && (
                      <div className={`absolute z-10 w-max rounded-lg border border-[var(--tip-border)] bg-[var(--tip)] px-2.5 py-2 shadow-[0_0_20px_var(--tip-shadow)] ${index >= 5 ? 'right-[calc(50%+18px)]' : 'left-[calc(50%+18px)]'}`}
                        style={{ bottom: `calc(${height} / 2)`, transform: 'translateY(50%)' }}>
                        <span className={`absolute top-1/2 size-[7px] -translate-y-1/2 rotate-45 bg-[var(--tip)] ${index >= 5 ? '-right-[4px]' : '-left-[4px]'}`} />
                        <div className="flex items-center gap-1.5 whitespace-nowrap text-[13px] leading-tight font-semibold text-white">
                          <span className="size-1.5 rounded-full bg-[var(--accent)]" />Rp {number.format(value)}
                        </div>
                        <div className="my-1.5 h-px bg-[var(--grid)]" />
                        <div className="text-[11px] leading-tight text-[var(--tip-date)]">{dates[index]}</div>
                      </div>
                    )}
                    <span className="absolute top-full mt-2 w-full text-center text-xs leading-none text-[var(--axis-x)]">{days[index]}</span>
                  </div>
                );
              })}
            </div>
            {!peak && <p aria-hidden="true" className="pointer-events-none absolute inset-0 m-0 grid place-items-center text-xs text-[var(--axis-y)]">Belum ada deal lunas di periode ini</p>}
          </div>
        </div>
      </section>
    </div>
  );
}
