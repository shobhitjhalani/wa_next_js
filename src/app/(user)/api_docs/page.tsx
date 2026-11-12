import type { Metadata } from 'next';
import { PageTitle } from '@/components/PageTitle';
import { requireUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { categoriesLabel } from '@/lib/template-categories';
import { CopyButton } from './CopyButton';

export const metadata: Metadata = { title: 'API' };

type Field = [name: string, type: string, description: string];

function Fields({ rows }: { rows: Field[] }) {
  return (
    <div className="table-responsive">
      <table className="table table-sm table-bordered small mb-3">
        <thead className="table-light"><tr><th style={{ width: '22%' }}>Field</th><th style={{ width: '14%' }}>Type</th><th>Description</th></tr></thead>
        <tbody>
          {rows.map(([n, t, d]) => <tr key={n}><td><code>{n}</code></td><td className="text-muted">{t}</td><td>{d}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <div className="position-relative mb-3">
      <div className="position-absolute top-0 end-0 m-2"><CopyButton text={children} /></div>
      <pre className="bg-light border rounded p-3 pe-5 small mb-0" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}><code>{children}</code></pre>
    </div>
  );
}

function Endpoint({ id, method, path, title, children }: { id: string; method: 'GET' | 'POST'; path: string; title: string; children: React.ReactNode }) {
  return (
    <div className="card" id={id}>
      <div className="card-header d-flex align-items-center gap-2 flex-wrap">
        <span className={`badge ${method === 'GET' ? 'bg-info' : 'bg-success'}`}>{method}</span>
        <code className="fs-6">{path}</code>
        <span className="text-muted ms-auto">{title}</span>
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

/** API documentation with the account's own key and base URL. */
export default async function ApiDocsPage() {
  const user = await requireUser();
  const base = `${config.appUrl}/api/v2`;
  const key = user.u_access_code ?? '';
  const H = `-H "X-API-Key: ${key}"`;

  return (
    <>
      <PageTitle title="API" home="/dashboard" />

      <div className="card">
        <div className="card-body">
          <div className="row g-3 align-items-center">
            <div className="col-lg-6">
              <div className="text-muted small mb-1">Base URL</div>
              <div className="d-flex gap-2 align-items-center"><code className="fs-6 text-break">{base}</code><CopyButton text={base} /></div>
            </div>
            <div className="col-lg-6">
              <div className="text-muted small mb-1">Your API key</div>
              <div className="d-flex gap-2 align-items-center"><code className="fs-6 text-break">{key}</code><CopyButton text={key} /></div>
            </div>
          </div>
          <hr />
          <p className="small mb-2">
            Send the key in an <code>X-API-Key</code> header (or <code>Authorization: Bearer &lt;key&gt;</code>) with every request.
            Keep it secret: anyone with the key can send messages from your WhatsApp number. Bodies are JSON, or{' '}
            <code>multipart/form-data</code> when you upload a file.
          </p>
          <p className="small mb-2">
            Every response is <code>{'{"success": true, "data": …}'}</code> or <code>{'{"success": false, "error": {"code", "message", "field"}}'}</code>.
            Messages are sent immediately; a single recipient gets the WhatsApp result in the response.
          </p>
          <p className="small mb-0">
            <a href="#send-template">Send template</a> · <a href="#send-text">Send text</a> · <a href="#send-media">Send attachment</a> ·{' '}
            <a href="#status">Message status</a> · <a href="#templates">List templates</a> · <a href="#create-template">Create template</a> ·{' '}
            <a href="#errors">Errors</a>
            {user.u_template_categories ? <> · <span className="text-warning-emphasis">Allowed template categories: {categoriesLabel(user.u_template_categories)}</span></> : null}
          </p>
        </div>
      </div>

      <Endpoint id="send-template" method="POST" path="/messages/template" title="Send an approved template">
        <Fields rows={[
          ['to', 'string | array', 'Mobile number with country code (e.g. 919876543210), a comma-separated list, or an array. Up to 100 numbers.'],
          ['template', 'string', 'Template name, as returned by GET /templates.'],
          ['language', 'string', 'Optional. Language code when the same name exists in several languages.'],
          ['parameters', 'array', 'Body values for {{1}}, {{2}}, … in order. Values may contain commas.'],
          ['header_url', 'string', 'Media header (image / video / document templates): public URL ending in .jpg/.png, .mp4 or .pdf.'],
          ['header_file', 'file', 'Instead of header_url: upload the header file (multipart/form-data).'],
          ['header_parameter', 'string', 'Value for {{1}} in a text header, when the template has one.'],
          ['button_parameters', 'object', 'Dynamic URL buttons: value that replaces {{1}} at the end of the button URL, by button index, e.g. {"0": "ORD-1001"}.'],
          ['cards', 'array', 'Carousel templates: one entry per card: {"media_url", "parameters": [], "button_parameters": {}}.'],
        ]} />
        <Code>{`curl -X POST ${base}/messages/template \\
  ${H} \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "919876543210",
    "template": "order_update",
    "parameters": ["Ravi", "ORD-1001"],
    "header_url": "https://example.com/invoice.pdf",
    "button_parameters": {"0": "ORD-1001"}
  }'`}</Code>
        <div className="small text-muted mb-1">With a file upload:</div>
        <Code>{`curl -X POST ${base}/messages/template \\
  ${H} \\
  -F to=919876543210 \\
  -F template=order_update \\
  -F 'parameters[]=Ravi' -F 'parameters[]=ORD-1001' \\
  -F header_file=@invoice.pdf`}</Code>
        <div className="small text-muted mb-1">Response (one recipient):</div>
        <Code>{`{
  "success": true,
  "data": {
    "messages": [{
      "id": "5dd317e5-23a6-48b9-a220-c60636e77dc4",
      "to": "919876543210",
      "type": "template",
      "template": "order_update",
      "status": "sent",
      "error": null,
      "whatsapp_message_id": "wamid.HBgM…",
      "created_at": "2026-11-13 10:15:02",
      "updated_at": "2026-11-13 10:15:03"
    }]
  }
}`}</Code>
        <p className="small text-muted mb-0">With several numbers the response is 202 with status <code>processing</code>; check each id with GET /messages/&#123;id&#125;.</p>
      </Endpoint>

      <Endpoint id="send-text" method="POST" path="/messages/text" title="Send a text message">
        <p className="small">Free-form messages can only be sent within 24 hours of the customer&apos;s last message to you (WhatsApp rule). Otherwise send a template.</p>
        <Fields rows={[
          ['to', 'string', 'One mobile number with country code.'],
          ['text', 'string', 'Message text (up to 4096 characters). WhatsApp formatting like *bold* works.'],
          ['buttons', 'array', 'Optional reply buttons: up to 3 show as buttons (20 characters each), up to 10 as a list (24 characters). No commas.'],
        ]} />
        <Code>{`curl -X POST ${base}/messages/text \\
  ${H} \\
  -H "Content-Type: application/json" \\
  -d '{"to": "919876543210", "text": "Your order is out for delivery 🚚", "buttons": ["Track", "Call me"]}'`}</Code>
      </Endpoint>

      <Endpoint id="send-media" method="POST" path="/messages/media" title="Send an attachment">
        <p className="small">Also within the 24-hour reply window. Images (.jpg, .png, .webp), videos (.mp4, .3gp) and documents (.pdf, .doc(x), .xls(x), .ppt(x), .txt, .csv), up to 16 MB.</p>
        <Fields rows={[
          ['to', 'string', 'One mobile number with country code.'],
          ['url', 'string', 'Public URL of the file, ending in its extension.'],
          ['file', 'file', 'Instead of url: upload the file (multipart/form-data).'],
          ['caption', 'string', 'Optional caption (up to 1024 characters).'],
        ]} />
        <Code>{`curl -X POST ${base}/messages/media \\
  ${H} \\
  -H "Content-Type: application/json" \\
  -d '{"to": "919876543210", "url": "https://example.com/brochure.pdf", "caption": "Our new brochure"}'`}</Code>
        <Code>{`curl -X POST ${base}/messages/media \\
  ${H} \\
  -F to=919876543210 -F caption="Your invoice" -F file=@invoice.pdf`}</Code>
      </Endpoint>

      <Endpoint id="status" method="GET" path="/messages/{id}" title="Message status">
        <p className="small">
          <code>status</code> is one of <code>processing</code>, <code>queued</code>, <code>sent</code>, <code>delivered</code>, <code>read</code>,{' '}
          <code>failed</code> (see <code>error</code>), <code>opted_out</code> or <code>cancelled</code>.
        </p>
        <Code>{`curl ${base}/messages/5dd317e5-23a6-48b9-a220-c60636e77dc4 \\
  ${H}`}</Code>
      </Endpoint>

      <Endpoint id="templates" method="GET" path="/templates" title="List templates">
        <Fields rows={[
          ['status', 'query', 'approved (default) or all.'],
          ['name', 'query', 'Only the template with this name.'],
          ['category', 'query', 'MARKETING, UTILITY or AUTHENTICATION.'],
          ['sync', 'query', '1 to fetch the latest templates from WhatsApp first (e.g. after one was approved).'],
        ]} />
        <p className="small">Each template lists its <code>body_parameters</code> count, <code>header</code> (type and whether it needs a parameter), <code>buttons</code> (with <code>dynamic</code> URL buttons and their <code>index</code>) and <code>can_send</code>.</p>
        <Code>{`curl "${base}/templates?sync=1" \\
  ${H}`}</Code>
      </Endpoint>

      <Endpoint id="create-template" method="POST" path="/templates" title="Create a template">
        <p className="small">The template is submitted to WhatsApp for review and can be sent once it is approved (check with GET /templates?sync=1). Carousel templates are created in the panel.</p>
        <Fields rows={[
          ['name', 'string', 'Lowercase letters, numbers and underscores, e.g. order_update.'],
          ['category', 'string', 'MARKETING or UTILITY.'],
          ['language', 'string', 'Language code, e.g. en (default), en_US, hi.'],
          ['body', 'string', 'Message text with variables {{1}}, {{2}}, … (up to 1024 characters).'],
          ['body_examples', 'array', 'One sample value per body variable (WhatsApp reviews them).'],
          ['header_type', 'string', 'NONE (default), TEXT, IMAGE, VIDEO or DOCUMENT.'],
          ['header_text', 'string', 'TEXT header (up to 60 characters, may contain {{1}}); header_example gives its sample value.'],
          ['header_file', 'file', 'IMAGE / VIDEO / DOCUMENT header: a sample file (multipart/form-data).'],
          ['footer', 'string', 'Optional footer (up to 60 characters).'],
          ['buttons', 'array', 'Up to 10: {"type": "QUICK_REPLY", "text"}, {"type": "URL", "text", "url", "example"} (url may end in {{1}}), {"type": "PHONE_NUMBER", "text", "phone"}.'],
        ]} />
        <Code>{`curl -X POST ${base}/templates \\
  ${H} \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "order_update",
    "category": "UTILITY",
    "language": "en",
    "header_type": "TEXT",
    "header_text": "Order update",
    "body": "Hi {{1}}, your order {{2}} has been shipped.",
    "body_examples": ["Ravi", "ORD-1001"],
    "footer": "Reply STOP to opt out",
    "buttons": [{"type": "URL", "text": "Track order", "url": "https://example.com/track/{{1}}", "example": "https://example.com/track/ORD-1001"}]
  }'`}</Code>
        <div className="small text-muted mb-1">With a media header (multipart; list fields as JSON strings):</div>
        <Code>{`curl -X POST ${base}/templates \\
  ${H} \\
  -F name=new_offer -F category=MARKETING -F header_type=IMAGE \\
  -F header_file=@offer.jpg \\
  -F 'body=Hi {{1}}, our festive offer is live!' \\
  -F 'body_examples=["Ravi"]'`}</Code>
      </Endpoint>

      <div className="card" id="errors">
        <div className="card-header"><h5 className="card-title mb-0">Errors</h5></div>
        <div className="card-body">
          <Fields rows={[
            ['401', 'missing_api_key / invalid_api_key', 'No key, or the key is wrong.'],
            ['403', 'account_inactive / plan_expired', 'The account is inactive or its WhatsApp plan has expired.'],
            ['403', 'category_not_allowed / limit_reached', 'The template category is not enabled for this account, or the template message limit is used up.'],
            ['404', 'template_not_found / message_not_found', 'Unknown template name or message id.'],
            ['409', 'template_exists', 'A template with this name and language already exists.'],
            ['422', 'validation_error', 'A field is missing or wrong; error.field names it.'],
            ['422', 'window_closed', 'The customer has not written in 24 hours: send a template instead.'],
            ['422', 'template_not_approved / whatsapp_rejected', 'The template is not approved, or WhatsApp refused the new template (reason in the message).'],
          ]} />
        </div>
      </div>
    </>
  );
}
