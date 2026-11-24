import type { Datum } from './types';
import { format } from './types';

export function DataTable({ data, label }: { data: readonly Datum[]; label: string }) {
  return <table className="sr-only"><caption>{label}</caption><thead><tr><th scope="col">Kategori</th><th scope="col">Nilai</th></tr></thead><tbody>
    {data.map(item => <tr key={item.key}><th scope="row">{item.label}</th><td>{format.format(item.value)}</td></tr>)}
  </tbody></table>;
}
