import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { query } from '@/lib/db';
import { sp } from '@/lib/http';
import { uploadContacts } from './actions';
import { UploadForm } from './UploadForm';

export const metadata: Metadata = { title: 'Upload Contacts' };

type Params = Promise<Record<string, string | string[] | undefined>>;

/** Upload contacts form + file format help (ContactController::uploadForm). */
export default async function UploadContactsPage({ searchParams }: { searchParams: Params }) {
  const user = await requireUser();
  const params = await searchParams;
  const groups = await query<{ ug_id: number; up_group_name: string }>(
    'SELECT ug_id, up_group_name FROM js_user_groups WHERE ug_user_id = $1 AND ug_dstatus = 0 ORDER BY up_group_name', [user.u_id],
  );
  const requested = parseInt(sp(params, 'group'), 10);
  const selected = groups.some((g) => g.ug_id === requested) ? String(requested) : (groups[0] ? String(groups[0].ug_id) : '');

  return (
    <>
      <PageTitle title="Upload Contacts" home="/dashboard" />
      <div className="row g-4">
        <div className="col-lg-7">
          <div className="card">
            <div className="card-body">
              <UploadForm action={uploadContacts} groups={groups} selectedGroup={selected} />
            </div>
          </div>
        </div>
        <div className="col-lg-5">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">File Format</h5></div>
            <div className="card-body">
              <p className="mb-2">One contact per row. A header row is optional; columns named <code>Mobile</code> (or Phone / Number / WhatsApp) and <code>Name</code> are found automatically, in any order.</p>
              <div className="table-responsive mb-3">
                <table className="table table-sm table-bordered mb-0 small">
                  <thead className="table-light"><tr><th>Mobile</th><th>Name</th></tr></thead>
                  <tbody>
                    <tr><td>9876543210</td><td>Ravi Kumar</td></tr>
                    <tr><td>+91 98123 45678</td><td>Priya Sharma</td></tr>
                    <tr><td>+971501234567</td><td>Ahmed</td></tr>
                  </tbody>
                </table>
              </div>
              <ul className="small text-muted ps-3 mb-3">
                <li>Spaces, dashes, <code>+</code> and a leading <code>0</code> are removed; +{config.countryCode} numbers are saved as 10 digits.</li>
                <li>Numbers you already have are not duplicated.</li>
                <li>Invalid numbers are skipped and listed after the upload.</li>
                <li>Old .xls files: open in Excel and save as .xlsx or CSV first.</li>
              </ul>
              <a href="/contacts/sample" className="btn btn-sm btn-soft-primary"><i className="ri-download-2-line" /> Download sample CSV</a>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
