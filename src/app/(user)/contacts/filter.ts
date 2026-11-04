import 'server-only';
import { like } from '@/lib/db';
import { sp } from '@/lib/http';

/**
 * The contact list filter (ContactController::query) shared by the page, the
 * bulk actions ("all matching") and the export. Always scoped to the user.
 */

export interface ContactFilter {
  q: string;
  /** '' = no group filter */
  group: string;
  status: string;
}

export function readFilter(params: Record<string, string | string[] | undefined> | URLSearchParams): ContactFilter {
  return { q: sp(params, 'q'), group: sp(params, 'group'), status: sp(params, 'status') };
}

/**
 * WHERE clause over js_user_contact_list aliased `c`. Parameters are appended
 * to `params` (which may already hold earlier ones).
 */
export function filterWhere(userId: number, f: ContactFilter, params: unknown[]): string {
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where = [`c.cl_user_id = ${p(userId)}`];
  if (f.group !== '') {
    where.push(`EXISTS (SELECT 1 FROM js_user_groups_contact gf WHERE gf.group_id = ${p(parseInt(f.group, 10) || 0)} AND gf.contact_id = c.cl_id)`);
  }
  if (f.status === 'opted_out') where.push('c.cl_opt_out = 1');
  if (f.status === 'no_group') where.push('NOT EXISTS (SELECT 1 FROM js_user_groups_contact gn WHERE gn.contact_id = c.cl_id)');
  if (f.q !== '') {
    const digits = f.q.replace(/\D/g, '');
    const name = `c.cl_name ILIKE ${p('%' + like(f.q) + '%')}`;
    where.push(digits ? `(${name} OR c.cl_mobile_no LIKE ${p('%' + digits + '%')})` : name);
  }
  return where.join(' AND ');
}

/** Query string of the filter (links back to the list, export URL). */
export function filterQuery(f: ContactFilter): string {
  const qs = new URLSearchParams();
  if (f.q) qs.set('q', f.q);
  if (f.group) qs.set('group', f.group);
  if (f.status) qs.set('status', f.status);
  const s = qs.toString();
  return s ? '?' + s : '';
}
