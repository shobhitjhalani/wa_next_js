'use client';

import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { modal, PasswordInput } from '@/components/ui';
import { NO_PERMS, PERM_OPTIONS, type TeamPerms } from '@/lib/team';
import { saveMember } from './actions';

export interface MemberValues {
  um_id: number; um_name: string; um_username: string; um_email: string; um_mobile: string; um_status: number; perms: TeamPerms;
}

function Choice({ prefix, name, options, value, label, icon }: {
  prefix: string; name: string; label: string; icon: string; value: string; options: readonly { value: string; label: string }[];
}) {
  return (
    <div className="mb-3">
      <div className="form-label fw-medium"><i className={`${icon} me-1 text-muted`} />{label}</div>
      <div className="d-flex flex-wrap gap-2">
        {options.map((o) => (
          <div key={o.value}>
            <input type="radio" className="btn-check" name={name} id={`${prefix}-${name}-${o.value}`} value={o.value} defaultChecked={value === o.value} />
            <label className="btn btn-sm btn-outline-primary" htmlFor={`${prefix}-${name}-${o.value}`}>{o.label}</label>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Add / edit a team member: login details and permissions. One modal per member (keyed by id) so defaults are right. */
export function MemberModal({ id, member }: { id: string; member?: MemberValues }) {
  const p = member?.perms ?? { ...NO_PERMS, inbox: 'own' as const };
  return (
    <div className="modal fade" id={id} tabIndex={-1} aria-hidden="true">
      <div className="modal-dialog modal-dialog-centered modal-lg">
        <div className="modal-content">
          <ActionForm action={saveMember} resetOnSuccess={!member} onResult={(r) => { if (r.ok) setTimeout(() => modal(id, 'hide'), 900); }}>
            <div className="modal-header">
              <h5 className="modal-title">{member ? `Edit ${member.um_name}` : 'Add team member'}</h5>
              <button type="button" className="btn-close" data-bs-dismiss="modal" aria-label="Close" />
            </div>
            <div className="modal-body">
              <input type="hidden" name="um_id" value={member?.um_id ?? 0} />
              <div className="row g-3 mb-4">
                <div className="col-md-6">
                  <label className="form-label" htmlFor={`${id}-name`}>Name</label>
                  <input className="form-control" id={`${id}-name`} name="name" defaultValue={member?.um_name} maxLength={100} />
                  <FieldError name="name" />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor={`${id}-username`}>Username (to sign in)</label>
                  <input className="form-control" id={`${id}-username`} name="username" defaultValue={member?.um_username} autoComplete="off" maxLength={60} />
                  <FieldError name="username" />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor={`${id}-password`}>{member ? 'New password' : 'Password'}</label>
                  <PasswordInput className="form-control" id={`${id}-password`} name="password" autoComplete="new-password" placeholder={member ? 'Leave empty to keep the current password' : 'At least 6 characters'} />
                  <FieldError name="password" />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor={`${id}-mobile`}>Mobile <span className="text-muted fw-normal">(optional)</span></label>
                  <input className="form-control" id={`${id}-mobile`} name="mobile" defaultValue={member?.um_mobile} inputMode="tel" />
                  <FieldError name="mobile" />
                </div>
                <div className="col-md-6">
                  <label className="form-label" htmlFor={`${id}-email`}>Email <span className="text-muted fw-normal">(optional)</span></label>
                  <input type="email" className="form-control" id={`${id}-email`} name="email" defaultValue={member?.um_email} />
                  <FieldError name="email" />
                </div>
                <div className="col-md-6 d-flex align-items-end">
                  <div className="form-check form-switch mb-2">
                    <input className="form-check-input" type="checkbox" role="switch" id={`${id}-active`} name="active" value="1" defaultChecked={(member?.um_status ?? 1) === 1} />
                    <label className="form-check-label" htmlFor={`${id}-active`}>Active (can sign in)</label>
                  </div>
                </div>
              </div>

              <h6 className="text-uppercase text-muted small fw-semibold mb-3">Permissions</h6>
              <Choice prefix={id} name="perm_template" label="WA Templates" icon="ri-file-edit-line" value={p.template} options={PERM_OPTIONS.template} />
              <div className="mb-3">
                <div className="form-label fw-medium"><i className="ri-megaphone-line me-1 text-muted" />Campaigns</div>
                <div className="form-check form-switch mb-2">
                  <input className="form-check-input" type="checkbox" role="switch" id={`${id}-camp-create`} name="perm_campaign_create" value="1" defaultChecked={p.campaignCreate} />
                  <label className="form-check-label" htmlFor={`${id}-camp-create`}>Can create campaigns</label>
                </div>
                <div className="d-flex flex-wrap gap-2">
                  {PERM_OPTIONS.campaignView.map((o) => (
                    <div key={o.value}>
                      <input type="radio" className="btn-check" name="perm_campaign_view" id={`${id}-cv-${o.value}`} value={o.value} defaultChecked={p.campaignView === o.value} />
                      <label className="btn btn-sm btn-outline-primary" htmlFor={`${id}-cv-${o.value}`}>{o.label}</label>
                    </div>
                  ))}
                </div>
              </div>
              <Choice prefix={id} name="perm_inbox" label="Inbox" icon="ri-chat-3-line" value={p.inbox} options={PERM_OPTIONS.inbox} />
              <p className="small text-muted mb-0">Team members never see the dashboard balance, plans, contacts, reports, API keys or settings.</p>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-light" data-bs-dismiss="modal">Cancel</button>
              <SubmitButton className="btn btn-success" pendingText="Saving…">{member ? 'Save changes' : 'Add member'}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
