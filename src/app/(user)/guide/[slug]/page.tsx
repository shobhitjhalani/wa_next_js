import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAccount } from '@/lib/auth';
import { PageTitle } from '@/components/PageTitle';
import { GUIDES, guidesFor } from '../guides';
import { Rich } from '../Rich';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return { title: GUIDES.find((g) => g.slug === slug)?.title ?? 'Guide Book' };
}

/** One guide: numbered steps with tips, a link to the page it is about, previous / next guide. */
export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { perms } = await requireAccount();
  const guides = guidesFor(perms);
  const at = guides.findIndex((g) => g.slug === slug);
  if (at < 0) notFound();
  const guide = guides[at];
  const prev = guides[at - 1];
  const next = guides[at + 1];

  return (
    <>
      <PageTitle title={guide.title} home="/dashboard">
        <Link href="/guide" className="btn btn-soft-secondary btn-sm"><i className="ri-arrow-left-line me-1" />Guide Book</Link>
      </PageTitle>

      <div className="row">
        <div className="col-xl-9">
          <div className="card">
            <div className="card-body">
              <div className="d-flex align-items-start gap-3 flex-wrap">
                <p className="text-muted mb-0 flex-grow-1">{guide.summary}</p>
                <Link href={guide.link.href} className="btn btn-success btn-sm"><i className="ri-external-link-line me-1" />{guide.link.label}</Link>
              </div>
              {guide.before && (
                <div className="alert alert-warning mt-3 mb-0">
                  <b><i className="ri-information-line me-1" />Before you start</b>
                  <ul className="mb-0 mt-1 ps-3">
                    {guide.before.map((b, i) => <li key={i}><Rich text={b} /></li>)}
                  </ul>
                </div>
              )}
            </div>
          </div>

          {guide.steps.map((s, i) => (
            <div className="card" key={i} id={`step-${i + 1}`}>
              <div className="card-body d-flex gap-3">
                <div className="avatar-xs flex-shrink-0">
                  <span className="avatar-title rounded-circle bg-primary text-white fw-semibold">{i + 1}</span>
                </div>
                <div className="flex-grow-1">
                  <h5 className="mb-2">{s.title}</h5>
                  {s.text.map((t, j) => <p key={j} className="mb-2"><Rich text={t} /></p>)}
                  {s.tips?.map((t, j) => (
                    <div key={j} className="text-muted small mt-1"><i className="ri-lightbulb-line text-warning me-1" /><Rich text={t} /></div>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <div className="d-flex justify-content-between gap-2 mb-4">
            {prev ? <Link href={`/guide/${prev.slug}`} className="btn btn-light"><i className="ri-arrow-left-line me-1" />{prev.title}</Link> : <span />}
            {next ? <Link href={`/guide/${next.slug}`} className="btn btn-primary">{next.title}<i className="ri-arrow-right-line ms-1" /></Link> : <Link href="/guide" className="btn btn-light">Back to Guide Book</Link>}
          </div>
        </div>

        <div className="col-xl-3 d-none d-xl-block">
          <div className="card position-sticky" style={{ top: 90 }}>
            <div className="card-header"><h6 className="card-title mb-0">Steps</h6></div>
            <div className="list-group list-group-flush">
              {guide.steps.map((s, i) => (
                <a key={i} href={`#step-${i + 1}`} className="list-group-item list-group-item-action small">{i + 1}. {s.title}</a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
