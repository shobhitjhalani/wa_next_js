import Link from 'next/link';
import { config } from '@/lib/config';
import { masterOptions, type Option } from '@/lib/models';
import type { MasterValueRow } from '@/lib/types';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { PageTitle } from '@/components/PageTitle';
import { saveMaster } from './actions';
import { masterFields, selectHeading, type Heading } from './_lib';

/** Add / edit form (admin/masters/form.blade.php). */
export async function MasterForm({ head, value }: { head: Heading; value: Partial<MasterValueRow> | null }) {
  const fields = masterFields(head.mh_id);
  const options = new Map<string, Option[]>();
  await Promise.all(fields.map(async ([key, , kind]) => {
    const h = selectHeading(kind);
    if (h !== null) options.set(key, await masterOptions(h));
  }));
  const current: Partial<MasterValueRow> = value ?? { mv_status: 1, mv_display_order: 1 };
  const str = (v: unknown) => (v == null ? '' : String(v));

  return (
    <>
      <PageTitle title={(value ? 'Edit ' : 'Add ') + (head.mh_name ?? '')} home="/wamaster/dashboard" />
      <div className="card">
        <div className="card-body">
          <ActionForm action={saveMaster.bind(null, head.mh_id, value?.mv_id ?? null)} className="row g-3">
            {fields.map(([key, label, kind]) => {
              const cur = str(current['mv_' + key]);
              return (
                <div key={key} className={kind === 'textarea' ? 'col-12' : 'col-md-6'}>
                  <label className="form-label" htmlFor={`f_${key}`}>{label}</label>
                  {kind === 'textarea' ? (
                    <textarea className="form-control" id={`f_${key}`} name={key} rows={5} defaultValue={cur} />
                  ) : kind === 'plan_type' ? (
                    <div>
                      {Object.entries(config.planTypes).map(([id, name]) => (
                        <div key={id} className="form-check form-check-inline">
                          <input className="form-check-input" type="radio" name={key} id={`pt_${id}`} value={id} defaultChecked={cur === id} required />
                          <label className="form-check-label" htmlFor={`pt_${id}`}>{name}</label>
                        </div>
                      ))}
                    </div>
                  ) : selectHeading(kind) !== null ? (
                    <select className="form-select" id={`f_${key}`} name={key} defaultValue={cur}>
                      <option value="">—</option>
                      {(options.get(key) ?? []).map((o) => <option key={o.value} value={String(o.value)}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input
                      className="form-control" id={`f_${key}`} name={key} defaultValue={kind === 'decimal' && cur !== '' ? Number(cur).toFixed(2) : cur}
                      type={kind === 'number' || kind === 'decimal' ? 'number' : 'text'}
                      {...(kind === 'decimal' ? { step: '0.01', min: '0' } : {})}
                      required={key === 'name'}
                    />
                  )}
                  <FieldError name={key} />
                </div>
              );
            })}
            <div className="col-md-6">
              <label className="form-label" htmlFor="status">Status</label>
              <select className="form-select" id="status" name="status" defaultValue={str(current.mv_status)}>
                <option value="1">Active</option>
                <option value="2">Inactive</option>
              </select>
              <FieldError name="status" />
            </div>
            <div className="col-12">
              <SubmitButton className="btn btn-success">Save</SubmitButton>{' '}
              <Link href={`/wamaster/masters/${head.mh_id}`} className="btn btn-light">Cancel</Link>
            </div>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
