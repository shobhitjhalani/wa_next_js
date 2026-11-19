import type { Metadata } from 'next';
import Link from 'next/link';
import { forbidden, notFound } from 'next/navigation';
import { PageTitle } from '@/components/PageTitle';
import { requireTeam } from '@/lib/auth';
import { listFlows } from '@/lib/services/meta';
import { templateFormValues } from '@/lib/services/templates';
import { updateTemplate } from '../../create/actions';
import { LANGUAGES } from '../../create/languages';
import { TemplateForm } from '../../create/TemplateForm';
import { loadEditableTemplate } from '../../template-edit';

export const metadata: Metadata = { title: 'Edit WA Template' };

/** Edit a standard template: loads it from WhatsApp and submits the changes for review. */
export default async function EditTemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireTeam((p) => p.template === 'edit');
  if (!user.u_wa_b_id) forbidden();
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  const found = await loadEditableTemplate(user.u_id, user, Number(id));
  if (!found) notFound();

  if (found.problem || !found.meta) {
    return (
      <>
        <PageTitle title="Edit WA Template" home="/dashboard" />
        <div className="card">
          <div className="card-body">
            <h5 className="mb-2">{found.row.ut_name}</h5>
            <p className="text-muted">{found.problem}</p>
            <Link href="/templates" className="btn btn-light">Back to templates</Link>
          </div>
        </div>
      </>
    );
  }

  const flows = await listFlows(user);
  return (
    <>
      <PageTitle title="Edit WA Template" home="/dashboard" />
      <div className="card">
        <div className="card-body">
          <TemplateForm
            action={updateTemplate.bind(null, Number(id))} languages={LANGUAGES} initialKind="STANDARD" flows={flows}
            categories={[]} initial={templateFormValues(found.meta)}
          />
        </div>
      </div>
    </>
  );
}
