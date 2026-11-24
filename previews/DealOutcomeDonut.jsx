import { useId } from 'react';

const categories = [
  { key: 'paid', label: 'Lunas', marker: 'var(--paid)', inner: 'var(--paid-inner)', outer: 'var(--paid-outer)' },
  { key: 'unanswered', label: 'Tidak terjawab', marker: 'var(--track)', inner: 'var(--neutral-inner)', outer: 'var(--neutral-outer)' },
  { key: 'rejected', label: 'Ditolak', marker: 'var(--rejected)', inner: 'var(--rejected-inner)', outer: 'var(--rejected-outer)' },
];

const palette = {
  '--canvas': '#111111', '--surface': '#1B1B1B', '--text': '#F2F2F2',
  '--muted': '#9A9A9A', '--dim': '#7A7A7A', '--chip': '#0C0C0C', '--chip-label': '#8E8E8E',
  '--paid': '#E9A13B', '--paid-inner': '#F5C066', '--paid-outer': '#B0701F',
  '--rejected': '#E7AA9A', '--rejected-inner': '#F2C1B2', '--rejected-outer': '#A66F62',
  '--track': '#262626', '--neutral-inner': '#2E2E2E', '--neutral-outer': '#1C1C1C',
  '--border': 'rgba(255,255,255,.07)', '--highlight': 'rgba(255,255,255,.10)',
  '--marker-border': 'rgba(255,255,255,.14)', '--active-border': 'rgba(233,161,59,.45)',
  '--ring-glow': 'rgba(233,161,59,.30)', '--chip-glow': 'rgba(233,161,59,.18)',
};

const radius = 67.5;
const gap = 100 * 2.5 / (2 * Math.PI * radius);
const percent = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 });

export default function DealOutcomeDonut({ values = { paid: 65, rejected: 13, unanswered: 22 } }) {
  const id = useId();
  const counts = categories.map(category => Math.max(0, Number(values[category.key]) || 0));
  const total = counts.reduce((sum, value) => sum + value, 0);
  const largest = counts.indexOf(Math.max(...counts));
  let offset = 0;
  const segments = categories.flatMap((category, index) => {
    if (!counts[index]) return [];
    const share = 100 * counts[index] / total;
    const start = offset;
    offset += share;
    const angle = (start + share / 2) / 100 * 2 * Math.PI;
    return [{ ...category, share, start, right: Math.sin(angle) >= 0,
      center: 100 - Math.cos(angle) * 106, active: index === largest }];
  });

  for (const right of [false, true]) {
    const side = segments.filter(segment => segment.right === right).sort((a, b) => a.center - b.center);
    for (let i = 1; i < side.length; i++) {
      side[i].center = Math.max(side[i].center, side[i - 1].center + 66);
    }
  }

  return (
    <div className="grid min-h-[350px] min-w-[500px] place-items-center bg-[var(--canvas)]" style={palette}>
      <section aria-labelledby={`${id}-title`} className="relative box-border h-[300px] w-[260px] rounded-[14px] border border-[var(--border)] border-t-[var(--highlight)] bg-[var(--surface)] p-4 shadow-[0_12px_34px_rgba(0,0,0,.30)]">
        <header className="flex items-center justify-between gap-1">
          <h2 id={`${id}-title`} className="m-0 whitespace-nowrap text-[19px] leading-6 font-light tracking-[-.01em] text-[var(--text)]">Hasil deal yang sudah selesai</h2>
          <span aria-hidden="true" className="text-lg leading-none text-[var(--dim)]">›</span>
        </header>
        <div className="relative mx-auto mt-3 size-[200px]">
          <svg viewBox="0 0 200 200" role="img" aria-label={total ? segments.map(segment => `${segment.label} ${percent.format(segment.share)}%`).join(', ') : 'Belum ada deal yang selesai'} className="block size-full overflow-visible">
            <defs>
              {categories.map(category => (
                <radialGradient key={category.key} id={`${id}-${category.key}`} gradientUnits="userSpaceOnUse" cx="100" cy="100" r="100">
                  <stop offset=".35" stopColor={category.inner} />
                  <stop offset="1" stopColor={category.outer} />
                </radialGradient>
              ))}
            </defs>
            {total === 0 && <circle cx="100" cy="100" r={radius} fill="none" stroke="var(--track)" strokeWidth="65" opacity=".5" />}
            {segments.map(segment => {
              const space = segments.length === 1 ? 0 : Math.min(gap, segment.share / 2);
              return <circle key={segment.key} cx="100" cy="100" r={radius} pathLength="100"
                transform="rotate(-90 100 100)" fill="none" stroke={`url(#${id}-${segment.key})`}
                strokeWidth="65" strokeLinecap="butt" strokeDasharray={`${segment.share - space} 100`}
                strokeDashoffset={-(segment.start + space / 2)}
                style={segment.key === 'paid' ? { filter: 'drop-shadow(0 0 24px var(--ring-glow))' } : undefined} />;
            })}
          </svg>
          {segments.map(segment => {
            const nearest = Math.max(0, Math.abs(segment.center - 100) - (segment.active ? 32 : 25));
            const edge = Math.sqrt(Math.max(0, 100 ** 2 - nearest ** 2));
            const side = segment.right ? 'left' : 'right';
            return (
              <div key={segment.key} aria-hidden="true"
                className={`absolute z-10 -translate-y-1/2 whitespace-nowrap rounded-[7px] bg-[var(--chip)] text-left leading-tight ${segment.active ? 'border border-[var(--active-border)] px-[13px] py-[11px] shadow-[0_0_18px_var(--chip-glow)]' : 'px-2.5 py-2'}`}
                style={{ top: segment.center, [side]: 106 + edge }}>
                <div className={`font-semibold text-white ${segment.active ? 'text-lg' : 'text-sm'}`}>{percent.format(segment.share)}%</div>
                <div className={`text-[var(--chip-label)] ${segment.active ? 'text-[13px]' : 'text-xs'}`}>{segment.label}</div>
              </div>
            );
          })}
        </div>
        <ul className={`absolute inset-x-0 bottom-4 m-0 flex list-none justify-center gap-4 p-0 text-xs text-[var(--muted)] ${total ? '' : 'opacity-[.38]'}`}>
          {[categories[0], categories[2], categories[1]].map(category => (
            <li key={category.key} className="flex items-center gap-1.5 whitespace-nowrap">
              <span aria-hidden="true" className={`size-[9px] rounded-[3px] ${category.key === 'unanswered' ? 'border border-[var(--marker-border)]' : ''}`} style={{ backgroundColor: category.marker }} />
              {category.label}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
