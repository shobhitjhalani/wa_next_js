import type { Metadata } from 'next';
import { randomBytes } from 'node:crypto';
import { PageTitle } from '@/components/PageTitle';
import { requireUser } from '@/lib/auth';
import { one, query } from '@/lib/db';
import { sp, spAll } from '@/lib/http';
import { now, phpDate } from '@/lib/time';
import { sendWindowLabel } from '@/lib/services/sender';
import { storeCampaign } from './actions';
import { ComposeForm } from './ComposeForm';
import { COMPOSE_TEMPLATE_COLUMNS, type ComposeTemplate } from './TemplateParts';

export const metadata: Metadata = { title: 'New Campaign' };

type Params = Promise<Record<string, string | string[] | undefined>>;

/** Random alphanumerics like Str::random(). */
function random(n: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(randomBytes(n), (b) => chars[b % chars.length]).join('');
}

/** New campaign: template, audience, schedule (User\ComposeController::create). */
export default async function ComposePage({ searchParams }: { searchParams: Params }) {
  const user = await requireUser();
  const params = await searchParams;
  const tm = sp(params, 'tm');
  const tmId = tm === '' ? null : parseInt(tm, 10) || 0;

  const [templates, groups] = await Promise.all([
    query<{ ut_id: number; ut_name: string }>(
      `SELECT ut_id, ut_name FROM js_user_templates
        WHERE ut_user_id = $1 AND ut_dstatus = 0 AND ut_status = 1 AND ($2::int IS NULL OR ut_id = $2)
        ORDER BY ut_id DESC`,
      [user.u_id, tmId],
    ),
    query<{ ug_id: number; up_group_name: string | null; contacts_count: number }>(
      `SELECT g.ug_id, g.up_group_name,
              (SELECT COUNT(*) FROM js_user_groups_contact gc JOIN js_user_contact_list c ON c.cl_id = gc.contact_id
                WHERE gc.group_id = g.ug_id)::int AS contacts_count
         FROM js_user_groups g
        WHERE g.ug_user_id = $1 AND g.ug_dstatus = 0
        ORDER BY g.up_group_name`,
      [user.u_id],
    ),
  ]);
  const selected = templates.length === 1
    ? await one<ComposeTemplate>(`SELECT ${COMPOSE_TEMPLATE_COLUMNS} FROM js_user_templates WHERE ut_id = $1 AND ut_user_id = $2`, [templates[0].ut_id, user.u_id])
    : null;

  const preselectedGroups = spAll(params, 'group').map((v) => parseInt(v, 10) || 0);

  return (
    <>
      <PageTitle title="New Campaign" home="/dashboard" />
      <ComposeForm
        action={storeCampaign}
        templates={templates}
        selected={selected}
        groups={groups.map((g) => ({ id: g.ug_id, name: g.up_group_name ?? '', count: g.contacts_count }))}
        preselectedGroups={preselectedGroups}
        mobile={sp(params, 'mb')}
        uniqueCode={`cu_${now()}_${user.u_id}_${random(6)}`}
        minSchedule={phpDate('Y-m-d\\TH:i', now() + 300)}
        sendWindow={sendWindowLabel()}
      />
    </>
  );
}
