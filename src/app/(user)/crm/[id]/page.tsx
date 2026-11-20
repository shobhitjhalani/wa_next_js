import '../crm.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';
import { notFound } from 'next/navigation';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireCrmUser } from '@/lib/auth';
import { followupTypeInfo, OPEN_STATUSES, sourceInfo, sourceOptions, STATUS_INFO } from '@/lib/crm';
import { customSources } from '@/lib/services/crm';
import { one, query } from '@/lib/db';
import { internationalise } from '@/lib/phone';
import { now, phpDate } from '@/lib/time';
import { FollowupForm, LeadModal } from '../LeadForms';
import { deleteLead } from '../actions';
import { followupLabel } from '../followup-label';

export const metadata: Metadata = { title: 'Lead' };

interface Lead {
  ld_id: number; ld_name: string; ld_mobile: string; ld_email: string; ld_source: string; ld_campaign: string; ld_status: number;
  ld_notes: string; ld_fields: Record<string, string>; ld_next_followup: number; ld_created_on: number; ld_updated_on: number;
  ld_meta_form_name: string; ld_meta_form_id: string; ld_meta_ad_name: string; ld_meta_ad_id: string; ld_meta_campaign_name: string;
  ld_meta_campaign_id: string; ld_platform: string; ld_phone_e164: string; ld_assigned_member: number; member: string | null;
}
interface Followup { fu_id: number; fu_type: string; fu_note: string; fu_status: number; fu_next_followup: number; fu_created_on: number }

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireCrmUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const [lead, history, own] = await Promise.all([
    one<Lead>('SELECT l.*, (SELECT um_name FROM js_user_member WHERE um_id = l.ld_assigned_member AND um_user_id = l.ld_user_id) AS member FROM js_crm_lead l WHERE l.ld_id = $1 AND l.ld_user_id = $2', [id, user.u_id]),
    query<Followup>('SELECT fu_id, fu_type, fu_note, fu_status, fu_next_followup, fu_created_on FROM js_crm_followup WHERE fu_lead_id = $1 AND fu_user_id = $2 ORDER BY fu_id DESC LIMIT 300', [id, user.u_id]),
    customSources(user.u_id),
  ]);
  if (!lead) notFound();

  const at = now();
  const src = sourceInfo(lead.ld_source);
  const st = STATUS_INFO[lead.ld_status] ?? STATUS_INFO[1];
  const open = (OPEN_STATUSES as readonly number[]).includes(Number(lead.ld_status));
  const fu = followupLabel(lead.ld_next_followup, at);
  const title = lead.ld_name || lead.ld_mobile || lead.ld_email || `Lead #${lead.ld_id}`;
  const fields = Object.entries(lead.ld_fields ?? {});

  return (
    <>
      <PageTitle title="Lead" home="/dashboard" />
      <div className="mb-3"><Link href="/crm" className="text-muted"><i className="ri-arrow-left-line align-middle" /> All leads</Link></div>
      <div className="row">
        <div className="col-xl-4">
          <div className="card">
            <div className="card-body">
              <div className="d-flex align-items-start gap-2 mb-3">
                <div className="flex-grow-1 min-w-0">
                  <h5 className="mb-1 text-truncate">{title}</h5>
                  <span className={`badge ${st.badge}`}>{st.label}</span>
                  <span className="ms-2 small text-muted"><i className={src.icon} /> {src.label}</span>
                </div>
                <button type="button" className="btn btn-sm btn-soft-primary" data-bs-toggle="modal" data-bs-target="#edit-lead"><i className="ri-pencil-line" /> Edit</button>
              </div>
              {open && (
                <div className={`crm-next p-2 ps-3 mb-3 bg-light rounded${fu.tone === 'text-danger' ? ' overdue' : ''}`}>
                  <div className="small text-muted">Next follow-up</div>
                  <div className={`fw-semibold ${fu.tone}`}>{fu.text || 'Not set'}</div>
                </div>
              )}
              <dl className="row mb-0 small crm-fields">
                <dt className="col-4">Mobile</dt>
                <dd className="col-8">{lead.ld_mobile || <span className="text-muted">—</span>}</dd>
                <dt className="col-4">Email</dt>
                <dd className="col-8">{lead.ld_email ? <a href={`mailto:${lead.ld_email}`}>{lead.ld_email}</a> : <span className="text-muted">—</span>}</dd>
                <dt className="col-4">Campaign</dt>
                <dd className="col-8">{lead.ld_campaign || <span className="text-muted">—</span>}</dd>
                {lead.ld_meta_campaign_name && (<><dt className="col-4">Meta campaign</dt><dd className="col-8">{lead.ld_meta_campaign_name}</dd></>)}
                {lead.ld_meta_ad_name && (<><dt className="col-4">Meta ad</dt><dd className="col-8">{lead.ld_meta_ad_name}</dd></>)}
                {lead.ld_meta_form_name && (<><dt className="col-4">Lead form</dt><dd className="col-8">{lead.ld_meta_form_name}</dd></>)}
                {lead.ld_platform && (<><dt className="col-4">Platform</dt><dd className="col-8">{lead.ld_platform === 'ig' ? <><i className="ri-instagram-line text-danger" /> Instagram</> : <><i className="ri-facebook-circle-fill text-primary" /> Facebook</>}</dd></>)}
                {lead.member && (<><dt className="col-4">Assigned to</dt><dd className="col-8">{lead.member}</dd></>)}
                <dt className="col-4">Received</dt>
                <dd className="col-8">{phpDate('d M Y, h:i A', lead.ld_created_on)}</dd>
                {lead.ld_notes && (<><dt className="col-4">Notes</dt><dd className="col-8 crm-tl-note">{lead.ld_notes}</dd></>)}
              </dl>
              {lead.ld_mobile && (
                <div className="d-flex gap-2 mt-3">
                  <Link href={`/chat?mb=${encodeURIComponent(lead.ld_mobile)}`} className="btn btn-sm btn-success flex-fill"><i className="ri-whatsapp-line" /> WhatsApp</Link>
                  <a href={`tel:+${internationalise(lead.ld_mobile)}`} className="btn btn-sm btn-soft-secondary flex-fill"><i className="ri-phone-line" /> Call</a>
                </div>
              )}
            </div>
          </div>
          {fields.length > 0 && (
            <div className="card">
              <div className="card-header"><h6 className="card-title mb-0">Form answers</h6></div>
              <div className="card-body">
                <dl className="row mb-0 small crm-fields">
                  {fields.map(([k, v]) => (
                    <Fragment key={k}>
                      <dt className="col-5 text-break">{k.replace(/_/g, ' ')}</dt>
                      <dd className="col-7">{String(v)}</dd>
                    </Fragment>
                  ))}
                </dl>
              </div>
            </div>
          )}
          <form action={deleteLead.bind(null, lead.ld_id, '/crm')} className="mb-3">
            <ConfirmButton message={`Delete the lead “${title}” and its follow-ups?`} className="btn btn-sm btn-link text-danger px-0">
              <i className="ri-delete-bin-line" /> Delete lead
            </ConfirmButton>
          </form>
        </div>
        <div className="col-xl-8">
          <div className="card" id="followup">
            <div className="card-header"><h5 className="card-title mb-0">Add follow-up</h5></div>
            <div className="card-body"><FollowupForm leadId={lead.ld_id} status={Number(lead.ld_status)} /></div>
          </div>
          <div className="card">
            <div className="card-header d-flex"><h5 className="card-title mb-0 me-auto">History</h5><span className="text-muted small">{history.length} entr{history.length === 1 ? 'y' : 'ies'}</span></div>
            <div className="card-body">
              <ul className="crm-timeline">
                {history.map((h) => {
                  const type = h.fu_type === 'system' ? { label: 'Lead', icon: 'ri-inbox-archive-line' } : followupTypeInfo(h.fu_type);
                  const status = h.fu_status ? STATUS_INFO[h.fu_status] : null;
                  return (
                    <li key={h.fu_id}>
                      <span className="crm-tl-icon"><i className={type.icon} /></span>
                      <div className="d-flex flex-wrap align-items-center gap-2">
                        <span className="fw-semibold">{type.label}</span>
                        {status && <span className={`badge ${status.badge}`}>{status.label}</span>}
                        <span className="small text-muted ms-auto">{phpDate('d M Y, h:i A', h.fu_created_on)}</span>
                      </div>
                      {h.fu_note && <div className="crm-tl-note mt-1">{h.fu_note}</div>}
                      {h.fu_next_followup > 0 && <div className="small text-muted mt-1"><i className="ri-alarm-line" /> Next follow-up set for {phpDate('D d M Y, h:i A', h.fu_next_followup)}</div>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
      <LeadModal id="edit-lead" sources={sourceOptions(own)} lead={{
        ld_id: lead.ld_id, ld_name: lead.ld_name, ld_mobile: lead.ld_mobile, ld_email: lead.ld_email,
        ld_source: lead.ld_source, ld_campaign: lead.ld_campaign, ld_notes: lead.ld_notes,
      }} />
    </>
  );
}
