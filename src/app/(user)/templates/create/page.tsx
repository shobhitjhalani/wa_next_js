import type { Metadata } from 'next';
import { forbidden } from 'next/navigation';
import { PageTitle } from '@/components/PageTitle';
import { requireUser } from '@/lib/auth';
import { sp } from '@/lib/http';
import { storeTemplate } from './actions';
import { LANGUAGES } from './languages';
import { TemplateForm } from './TemplateForm';

export const metadata: Metadata = { title: 'Create WA Template' };

/** New standard / carousel template form (User\TemplateController::create). */
export default async function CreateTemplatePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  // Templates are created through the API on the account's WABA
  if (!user.u_wa_b_id) forbidden();
  const kind = sp(await searchParams, 'kind') === 'carousel' ? 'CAROUSEL' : 'STANDARD';
  return (
    <>
      <PageTitle title="Create WA Template" home="/dashboard" />
      <div className="card">
        <div className="card-body">
          <TemplateForm action={storeTemplate} languages={LANGUAGES} initialKind={kind} />
        </div>
      </div>
    </>
  );
}
