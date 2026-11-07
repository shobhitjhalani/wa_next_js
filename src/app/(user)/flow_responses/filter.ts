import { sp } from '@/lib/http';
import { parseDateRange } from '@/lib/time';

/** Filters shared by the Flow Responses page and its CSV export. */
export interface FlowFilter {
  date: string;
  mobile: string;
  template: string;
  read: string; // '' all · '1' read · '2' unread
}

export function readFilter(params: Record<string, string | string[] | undefined> | URLSearchParams): FlowFilter {
  const read = sp(params, 'read_status');
  return {
    date: sp(params, 'fr_date'),
    mobile: sp(params, 'mobile_no'),
    template: sp(params, 'template'),
    read: read === '1' || read === '2' ? read : '',
  };
}

/** WHERE clause on js_flow_responses for the user; pushes values onto `args`. */
export function filterWhere(userId: number, f: FlowFilter, args: unknown[]): string {
  args.push(userId);
  let where = `fr_user_id = $${args.length}`;
  const range = parseDateRange(f.date);
  if (range) {
    args.push(range[0], range[1]);
    where += ` AND fr_created_on BETWEEN $${args.length - 1} AND $${args.length}`;
  }
  if (f.mobile !== '') { args.push(f.mobile); where += ` AND fr_mobile_no = $${args.length}`; }
  if (f.template === '-') where += ' AND fr_template_name IS NULL';
  else if (f.template !== '') { args.push(f.template); where += ` AND fr_template_name = $${args.length}`; }
  if (f.read !== '') { args.push(Number(f.read)); where += ` AND fr_is_read = $${args.length}`; }
  return where;
}
