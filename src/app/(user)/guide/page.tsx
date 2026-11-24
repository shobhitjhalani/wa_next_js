import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAccount } from '@/lib/auth';
import { PageTitle } from '@/components/PageTitle';
import { guidesFor } from './guides';

export const metadata: Metadata = { title: 'Guide Book' };

/** Guide Book: the step-by-step guides this account (or team member) can follow. */
export default async function GuideBookPage() {
  const { perms } = await requireAccount();
  const guides = guidesFor(perms);
  return (
    <>
      <PageTitle title="Guide Book" home="/dashboard" />
      <p className="text-muted">Step-by-step guides for the main tasks. Open one and follow the steps; you can come back here any time from <b>Guide Book</b> in the menu.</p>
      <div className="row">
        {guides.map((g, i) => (
          <div className="col-md-6 col-xl-4" key={g.slug}>
            <div className="card card-height-100">
              <div className="card-body d-flex flex-column">
                <div className="d-flex align-items-center mb-3">
                  <div className="avatar-sm flex-shrink-0 me-3">
                    <span className="avatar-title bg-primary-subtle text-primary rounded fs-3"><i className={g.icon} /></span>
                  </div>
                  <div>
                    <p className="text-muted mb-1 small">Guide {i + 1} · {g.steps.length} steps</p>
                    <h5 className="mb-0">{g.title}</h5>
                  </div>
                </div>
                <p className="text-muted flex-grow-1">{g.summary}</p>
                <div>
                  <Link href={`/guide/${g.slug}`} className="btn btn-primary btn-sm"><i className="ri-book-open-line me-1" />Read guide</Link>
                </div>
              </div>
            </div>
          </div>
        ))}
        {!guides.length && <div className="col-12"><div className="alert alert-info">No guides for your access yet.</div></div>}
      </div>
    </>
  );
}
