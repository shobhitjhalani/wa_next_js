import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { ConfirmButton } from '@/components/ui';
import { requireAdminCan } from '@/lib/auth';
import { config } from '@/lib/config';
import { value } from '@/lib/db';
import { MSG_EXPIRY_MAX, MSG_EXPIRY_MIN, refreshSendSettings, SEND_BATCH_MAX, SEND_DEFAULTS, sendSettingsChanged } from '@/lib/services/settings';
import { numberFormat } from '@/lib/text';
import { resetSendLimits, saveSendLimits } from './actions';
import { SettingsTabs } from './parts';

export const metadata: Metadata = { title: 'Sending Limits' };

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00${h === 24 ? ' (midnight)' : ` (${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'})`}`;

/** Settings → Sending Limits for queued campaign / template messages (super admin). */
export default async function SettingsPage() {
  await requireAdminCan('super');
  const [s, changed, overrides] = await Promise.all([
    refreshSendSettings(true), sendSettingsChanged(),
    value<number>('SELECT COUNT(*)::int FROM js_user WHERE u_msg_expiry_hours > 0 AND u_dstatus = 0'),
  ]);
  const perDay = s.sendBatch * 60 * (s.sendEndHour - s.sendStartHour);
  const custom = s.sendBatch !== SEND_DEFAULTS.sendBatch || s.sendStartHour !== SEND_DEFAULTS.sendStartHour || s.sendEndHour !== SEND_DEFAULTS.sendEndHour
    || s.msgExpiryHours !== SEND_DEFAULTS.msgExpiryHours;
  const tabs = <SettingsTabs tab="limits" />;
  return (
    <>
      <PageTitle title="Settings" home="/wamaster/dashboard" />
      {tabs}
      <div className="row">
        <div className="col-xl-7">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">Campaign sending</h5></div>
            <div className="card-body">
              {/* keyed by the values so the fields show what was saved (defaultValue only applies on mount) */}
              <form key={`${s.sendBatch}-${s.sendStartHour}-${s.sendEndHour}-${s.msgExpiryHours}`} action={saveSendLimits} className="row g-3">
                <div className="col-md-4">
                  <label className="form-label" htmlFor="send_batch">Messages per minute <span className="text-muted">(per account)</span></label>
                  <input type="number" className="form-control" id="send_batch" name="send_batch" min={1} max={SEND_BATCH_MAX} step={1} defaultValue={s.sendBatch} required />
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="send_start_hour">Sending starts</label>
                  <select className="form-select" id="send_start_hour" name="send_start_hour" defaultValue={s.sendStartHour}>
                    {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="send_end_hour">Sending stops</label>
                  <select className="form-select" id="send_end_hour" name="send_end_hour" defaultValue={s.sendEndHour}>
                    {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
                  </select>
                </div>
                <div className="col-md-4">
                  <label className="form-label" htmlFor="msg_expiry_hours">Message expiry <span className="text-muted">(hours)</span></label>
                  <input type="number" className="form-control" id="msg_expiry_hours" name="msg_expiry_hours" min={MSG_EXPIRY_MIN} max={MSG_EXPIRY_MAX} step={1} defaultValue={s.msgExpiryHours} required />
                </div>
                <div className="col-md-8 small text-muted align-self-end">
                  Messages not sent within this time are cancelled and can&apos;t be re-sent (&ldquo;older than {s.msgExpiryHours} hours and has expired&rdquo;).
                  A different time can be set for one user on the user&apos;s page{Number(overrides) > 0 ? <> ({numberFormat(Number(overrides))} user(s) have their own)</> : null}.
                </div>
                <div className="col-12 small text-muted">
                  At this rate one account sends about <strong>{numberFormat(s.sendBatch * 60)}</strong> messages an hour and up to{' '}
                  <strong>{numberFormat(perDay)}</strong> a day ({config.timezone}). Chat replies, API / OTP and chatbot messages are not held by these limits.
                  Template message quotas are still set per user.
                </div>
                <div className="col-12 d-flex gap-2">
                  <button type="submit" className="btn btn-primary"><i className="ri-save-line" /> Save</button>
                </div>
              </form>
              {custom && (
                <form action={resetSendLimits} className="mt-2">
                  <ConfirmButton message="Go back to the server defaults?" className="btn btn-sm btn-link px-0">
                    Reset to server defaults ({numberFormat(SEND_DEFAULTS.sendBatch)}/min, {String(SEND_DEFAULTS.sendStartHour).padStart(2, '0')}:00–{String(SEND_DEFAULTS.sendEndHour).padStart(2, '0')}:00, expiry {SEND_DEFAULTS.msgExpiryHours} h)
                  </ConfirmButton>
                </form>
              )}
            </div>
            {changed && (
              <div className="card-footer small text-muted">
                Last changed {new Date(changed.at).toLocaleString('en-IN', { timeZone: config.timezone, dateStyle: 'medium', timeStyle: 'short' })}{changed.by ? ` by ${changed.by}` : ''}
              </div>
            )}
          </div>
        </div>
        <div className="col-xl-5">
          <div className="card">
            <div className="card-body small">
              <h6>How it works</h6>
              <ul className="mb-0 ps-3">
                <li>Every minute the sender takes up to this many queued messages per account, oldest first, and sends them.</li>
                <li>Outside the sending hours queued campaign messages wait; messages older than {s.msgExpiryHours} hours (or the user&apos;s own expiry) are never sent.</li>
                <li>WhatsApp also caps each phone number (unique customers per 24 h by quality tier, and about 80 messages a second). Going far above a few hundred a minute risks WhatsApp rejecting messages.</li>
                <li>The campaign page&apos;s finish-time estimate uses these values.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
