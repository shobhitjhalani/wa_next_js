import type { Metadata } from 'next';
import { ActionForm, FieldError, SubmitButton } from '@/components/ActionForm';
import { PageTitle } from '@/components/PageTitle';
import { requireAdminCan } from '@/lib/auth';
import { config } from '@/lib/config';
import { GRAPH_DEFAULTS, GRAPH_SERVICES, graphVersions, graphVersionsChanged, type GraphService } from '@/lib/services/graph-version';
import { saveGraphVersionsAction } from '../actions';
import { SettingsTabs } from '../parts';

export const metadata: Metadata = { title: 'Graph API' };

/** Settings → Graph API: the Meta Graph API version of each app service (super admin). */
export default async function GraphApiPage() {
  await requireAdminCan('super');
  const [versions, changed] = await Promise.all([graphVersions(), graphVersionsChanged()]);
  const keys = Object.keys(GRAPH_SERVICES) as GraphService[];
  return (
    <>
      <PageTitle title="Settings" home="/wamaster/dashboard" />
      <SettingsTabs tab="graph" />
      <div className="row">
        <div className="col-xl-7">
          <div className="card">
            <div className="card-header"><h5 className="card-title mb-0">Graph API versions</h5></div>
            <div className="card-body">
              <ActionForm action={saveGraphVersionsAction} key={keys.map((k) => versions[k].version + versions[k].saved).join('|')}>
                {keys.map((k) => (
                  <div key={k} className="row g-2 align-items-start mb-3">
                    <div className="col-md-5">
                      <label className="form-label mb-0 fw-semibold" htmlFor={`graph_${k}`}>{GRAPH_SERVICES[k].label}</label>
                      <div className="small text-muted">{GRAPH_SERVICES[k].help}</div>
                    </div>
                    <div className="col-md-3">
                      <input className="form-control" id={`graph_${k}`} name={`graph_${k}`} placeholder={`Default: ${GRAPH_DEFAULTS[k]}`}
                        defaultValue={versions[k].saved ? versions[k].version : ''} pattern={String.raw`v?\d{1,2}\.\d`} title="e.g. v25.0" />
                      <FieldError name={`graph_${k}`} />
                    </div>
                    <div className="col-md-4 small pt-2">
                      In use: <code>{versions[k].version}</code>{' '}
                      {versions[k].saved ? <span className="badge bg-info-subtle text-info">Set here</span> : <span className="badge bg-light text-muted">Server default</span>}
                    </div>
                  </div>
                ))}
                <SubmitButton className="btn btn-primary"><i className="ri-save-line" /> Save</SubmitButton>
              </ActionForm>
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
              <ul className="ps-3 mb-0">
                <li>Leave a field empty to use the server default (.env: <code>WA_API_URL</code>, <code>META_GRAPH_VERSION</code>).</li>
                <li>Before saving, each typed version is tried with Meta using that service&apos;s token; a version Meta doesn&apos;t accept is not saved.</li>
                <li>The app and the worker switch within 30 seconds. The Login SDK version applies the next time a user opens the dashboard.</li>
                <li>Meta supports each version for about two years: see the <a href="https://developers.facebook.com/docs/graph-api/changelog/versions" target="_blank" rel="noreferrer">version list</a> before switching, and send a test message after.</li>
                <li>Changes are recorded in the Activity Log.</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
