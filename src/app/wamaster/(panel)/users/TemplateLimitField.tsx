'use client';

import { useState } from 'react';
import { FieldError } from '@/components/ActionForm';

/** Template message limit on the admin user form: Unlimited, or a total the account may send. */
export function TemplateLimitField({ limit, used, exists }: { limit: number; used: number; exists: boolean }) {
  const [unlimited, setUnlimited] = useState(limit <= 0);
  return (
    <div className="col-12">
      <label className="form-label mb-1">Template Message Limit</label>
      <div className="row g-2 align-items-center">
        <div className="col-auto">
          <div className="btn-group" role="group" aria-label="Template message limit">
            <input type="radio" className="btn-check" name="msg_limit_type" id="msg_limit_unlimited" value="unlimited"
              checked={unlimited} onChange={() => setUnlimited(true)} />
            <label className="btn btn-outline-primary" htmlFor="msg_limit_unlimited">Unlimited</label>
            <input type="radio" className="btn-check" name="msg_limit_type" id="msg_limit_limited" value="limited"
              checked={!unlimited} onChange={() => setUnlimited(false)} />
            <label className="btn btn-outline-primary" htmlFor="msg_limit_limited">Limited</label>
          </div>
        </div>
        {!unlimited && (
          <div className="col-md-3 col-sm-6">
            <input type="number" min="1" className="form-control" id="msg_limit" name="msg_limit" aria-label="Template messages allowed"
              placeholder="Messages allowed" defaultValue={limit > 0 ? limit : ''} required />
          </div>
        )}
        {exists && (
          <div className="col-auto text-muted small">
            Used: <strong>{used.toLocaleString('en-US')}</strong>
            {!unlimited && limit > 0 && <> of {limit.toLocaleString('en-US')} · left {Math.max(0, limit - used).toLocaleString('en-US')}</>}
          </div>
        )}
        {exists && used > 0 && (
          <div className="col-auto">
            <div className="form-check">
              <input className="form-check-input" type="checkbox" id="msg_used_reset" name="msg_used_reset" value="1" />
              <label className="form-check-label" htmlFor="msg_used_reset">Reset used count to 0</label>
            </div>
          </div>
        )}
      </div>
      <FieldError name="msg_limit" />
      <div className="form-text">Counts template messages WhatsApp accepted. When the limit is reached, further template messages are not sent.</div>
    </div>
  );
}
