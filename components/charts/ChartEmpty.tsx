export function ChartEmpty({ label }: { label: string }) {
  return <p className="pointer-events-none absolute inset-0 m-0 grid place-items-center text-center text-xs text-[var(--text-muted)]">{label}</p>;
}
