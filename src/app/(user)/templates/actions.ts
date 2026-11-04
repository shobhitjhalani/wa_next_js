'use server';

import { redirect } from 'next/navigation';
import { flash } from '@/lib/actions';
import { requireUser } from '@/lib/auth';
import { exec } from '@/lib/db';

/** Hide a template from the list (User\TemplateController::destroy). */
export async function destroyTemplate(id: number): Promise<void> {
  const user = await requireUser();
  await exec('UPDATE js_user_templates SET ut_dstatus = 1 WHERE ut_id = $1 AND ut_user_id = $2', [Number(id) || 0, user.u_id]);
  await flash('success', 'Template Successfully Deleted');
  redirect('/templates');
}
