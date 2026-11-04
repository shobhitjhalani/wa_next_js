import Link from 'next/link';
import { cookies } from 'next/headers';
import { FlashAlert, type Flash } from './FlashAlert';

/**
 * Page heading + breadcrumb (the Blade base layout's page-title-box) and the
 * one-time flash alert. Every panel page renders this first:
 *
 *   <PageTitle title="Contacts" home="/dashboard" />
 */
export async function PageTitle({ title, home, children }: { title: string; home: string; children?: React.ReactNode }) {
  const raw = (await cookies()).get('wa_flash')?.value;
  let flash: Flash | null = null;
  if (raw) {
    try {
      flash = JSON.parse(raw) as Flash;
    } catch {
      flash = null;
    }
  }
  return (
    <>
      <title>{title}</title>
      <div className="row">
        <div className="col-12">
          <div className="page-title-box d-sm-flex align-items-center justify-content-between">
            <h4 className="mb-sm-0">{title}</h4>
            <div className="page-title-right d-flex align-items-center gap-2">
              {children}
              <ol className="breadcrumb m-0">
                <li className="breadcrumb-item"><Link href={home}>Dashboard</Link></li>
                <li className="breadcrumb-item active">{title}</li>
              </ol>
            </div>
          </div>
        </div>
      </div>
      {flash && <FlashAlert key={flash.id} flash={flash} />}
    </>
  );
}
