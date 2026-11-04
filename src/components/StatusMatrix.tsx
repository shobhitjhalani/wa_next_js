import type { Matrix } from '@/lib/services/reports';
import { numberFormat, ucfirst } from '@/lib/text';

/** Template × status table with row and column totals (partials/status-matrix.blade.php). */
export function StatusMatrix({ matrix, firstCol }: { matrix: Matrix; firstCol: string }) {
  if (!matrix.rows.length) return <p className="text-muted mb-0">No messages for this period.</p>;
  const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
  return (
    <div className="table-responsive">
      <table className="table table-sm align-middle table-nowrap table-striped table-report mb-0">
        <thead className="table-light">
          <tr>
            <th>#</th>
            <th>{firstCol}</th>
            {matrix.columns.map((c) => <th key={c} className="num">{ucfirst(c)}</th>)}
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map(([name, row], i) => (
            <tr key={name}>
              <td>{i + 1}</td>
              <td>{name}</td>
              {matrix.columns.map((c) => <td key={c} className="num">{numberFormat(row[c] ?? 0)}</td>)}
              <th className="num">{numberFormat(sum(row))}</th>
            </tr>
          ))}
        </tbody>
        <tfoot className="table-light">
          <tr>
            <th colSpan={2}>Total</th>
            {matrix.columns.map((c) => <th key={c} className="num">{numberFormat(matrix.totals[c] ?? 0)}</th>)}
            <th className="num">{numberFormat(sum(matrix.totals))}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
