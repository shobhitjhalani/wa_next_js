# WA Panel: API Reference

All HTTP APIs of the WA Panel (https://wa.jscoretech.com). A Postman collection with every request below is in
[WA-Panel-API.postman_collection.json](WA-Panel-API.postman_collection.json): import it into Postman, then set the collection
variables `app_url`, `api_key` and `to`.

| # | API | Base URL | Auth | Use it for |
|---|-----|----------|------|------------|
| 1 | [REST API v2](#1-rest-api-v2) | `/api/v2` | `X-API-Key` header | New integrations: send templates, text and media, message status, list and create templates |
| 2 | [Legacy API v1](#2-legacy-api-v1) | `/api/secure/v1/{action}/` | `access_key` or `username` + `password` in the body | Existing clients and the Google Sheet add-on |
| 3 | [Legacy URLs](#3-legacy-urls) | `/waapi/…`, `/wa/secure/v1/…` | as v1 | Old URLs that still work |
| 4 | [Leads CRM webhook](#4-leads-crm-webhook) | `/api/crm/{key}` | key in the URL (+ Facebook signature) | Leads from website forms, Zapier, Make, Facebook Lead Ads |
| 5 | [Webhooks and callbacks](#5-webhooks-and-callbacks) | `/waapi/webhook`, `/integrations/meta/webhook`, `/api/shopify/v1/…`, `/payment/ccavenue/callback` | signatures | Called by Meta, Shopify and CCAvenue |
| 6 | [Outgoing: CRM WA API](#6-outgoing-crm-wa-api) | `crm.jscoretech.com` | `x-api-key` | The daily expiry / limit report this app sends |

The API key of an account is shown in the user panel under **Profile → API Access Key** (`js_user.u_access_code`).
Phone numbers always include the country code, without `+` or spaces, for example `919876543210`.

> Requests that send messages send real WhatsApp messages and use the account's template limit. Test with your own number.

---

## 1. REST API v2

Base URL: `https://wa.jscoretech.com/api/v2`

### Authentication

Send the account's API key in a header:

```
X-API-Key: YOUR_API_KEY
```

`Authorization: Bearer YOUR_API_KEY` also works. Only active WhatsApp accounts (user type 2) with a connected number can use it.
Sending endpoints also need an active WhatsApp plan.

### Request and response format

- Bodies are JSON (`Content-Type: application/json`). To upload a file, use `multipart/form-data`; list and object fields are then sent
  as JSON strings, or as repeated `name[]` fields.
- Success: `{"success": true, "data": { … }}`
- Error: `{"success": false, "error": {"code": "…", "message": "…", "field": "…"}}` (`field` only for validation errors)
- API messages go out straight away; they are not held to the campaign sending hours.

### Error codes

| HTTP | code | Meaning |
|------|------|---------|
| 400 | `invalid_json`, `invalid_body` | The body is not a JSON object or readable form data |
| 401 | `missing_api_key` | No `X-API-Key` header |
| 401 | `invalid_api_key` | The key does not match an account |
| 403 | `account_inactive` | The account is switched off |
| 403 | `plan_expired` | The WhatsApp plan has expired (sending endpoints) |
| 403 | `whatsapp_not_connected` | No WhatsApp number or Business Account connected yet |
| 403 | `category_not_allowed` | The account may not send this template category |
| 403 | `limit_reached` | The template message limit is used up (or too few messages left for the recipients) |
| 404 | `template_not_found`, `message_not_found` | Unknown template name or message id |
| 409 | `template_exists` | A template with this name and language already exists |
| 422 | `validation_error` | A field is missing or wrong (see `field`) |
| 422 | `template_not_approved` | The template is not approved |
| 422 | `window_closed` | Text / media outside the 24-hour customer window: send a template instead |
| 422 | `whatsapp_rejected` | WhatsApp refused the new template |
| 500 | `server_error` | Unexpected error; try again |

### Message object

Every send endpoint and the status endpoint return messages in this form:

```json
{
  "id": "6b1d7c8e-3f0a-4c55-9a5e-1d2f3a4b5c6d",
  "to": "919876543210",
  "type": "template",
  "template": "order_update",
  "status": "sent",
  "error": null,
  "whatsapp_message_id": "wamid.HBgM…",
  "created_at": "2026-11-24 11:02:10",
  "updated_at": "2026-11-24 11:02:11"
}
```

`status` is one of `processing`, `queued`, `sent`, `delivered`, `read`, `failed` (see `error`), `opted_out` or `cancelled`.

When a request goes to **one** number, the message is sent before the response: HTTP **201** (or **200** with `status: failed`).
When it goes to **several** numbers (up to 100), the response is **202** with every message `processing`, and they are sent in the background.
Use `GET /messages/{id}` to follow them.

### GET /templates

The account's templates.

| Query | Description |
|-------|-------------|
| `sync=1` | Fetch the latest templates from WhatsApp first |
| `status` | `approved` (default) or `all` |
| `name` | Only this template |
| `category` | `MARKETING`, `UTILITY` or `AUTHENTICATION` |

Each template: `id`, `name`, `language`, `category`, `type`, `status`, `header` (`type`, `text` + `parameters`, or `sample_url`),
`body`, `body_parameters` (number of `{{n}}` values), `footer`, `buttons` (`index`, `type`, `text`, `url`, `dynamic`), `cards` (carousel).

### POST /templates

Create a standard template; it is submitted to WhatsApp for review. Use a multipart body when the header is a media file.

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Lowercase letters, numbers and `_` |
| `category` | yes | `MARKETING` or `UTILITY` (as allowed for the account) |
| `language` | yes | e.g. `en`, `en_US`, `hi` |
| `body` | yes | Up to 1024 characters; variables `{{1}}`, `{{2}}` … without gaps |
| `body_examples` | if variables | Array, one sample per body variable |
| `header_type` | no | `NONE` (default), `TEXT`, `IMAGE`, `VIDEO`, `DOCUMENT` |
| `header_text` | for TEXT | Up to 60 characters, at most one variable `{{1}}` |
| `header_example` | if header variable | Sample value |
| `header_file` | for media | Sample file (multipart): image .jpg/.png up to 5 MB, video, document |
| `footer` | no | Up to 60 characters |
| `buttons` | no | Up to 10: `{"type":"QUICK_REPLY","text"}`, `{"type":"URL","text","url","example"}`, `{"type":"PHONE_NUMBER","text","phone"}` |

```json
{
  "name": "order_update",
  "category": "UTILITY",
  "language": "en",
  "header_type": "TEXT",
  "header_text": "Order update",
  "body": "Hi {{1}}, your order {{2}} has been shipped.",
  "body_examples": ["Ravi", "ORD-1001"],
  "footer": "Reply STOP to opt out",
  "buttons": [{"type": "URL", "text": "Track order", "url": "https://example.com/track/{{1}}", "example": "https://example.com/track/ORD-1001"}]
}
```

Response **201**: `{"template": {"name", "language", "category", "status": "PENDING"}}`.

### POST /messages/template

Send an approved template.

| Field | Required | Description |
|-------|----------|-------------|
| `to` | yes | A number, a comma-separated list or an array (up to 100) |
| `template` | yes | Template name |
| `language` | no | When the name exists in several languages |
| `parameters` | if the body has variables | Body values in order: `{{1}}`, `{{2}}` … (not empty, up to 1024 characters each) |
| `header_parameter` | if the text header has `{{1}}` | Value for the header variable |
| `header_url` | for media headers | Public URL ending in .jpg/.png, .mp4 or .pdf |
| `header_file` | instead of `header_url` | Upload (multipart) |
| `button_parameters` | for dynamic URL buttons | By button index: `{"0": "ORD-1001"}` |
| `cards` | carousel templates | One per card: `media_url`, `parameters`, `button_parameters` |

```json
{
  "to": "919876543210",
  "template": "order_update",
  "parameters": ["Ravi", "ORD-1001"],
  "button_parameters": {"0": "ORD-1001"}
}
```

Response: `{"messages": [ <message object> … ]}`.

### POST /messages/text

Free text inside the 24-hour window (the customer wrote to the account in the last 24 hours), otherwise `window_closed`.

| Field | Required | Description |
|-------|----------|-------------|
| `to` | yes | Number(s) |
| `text` | yes | Up to 4096 characters; WhatsApp formatting (`*bold*`) works |
| `buttons` | no | Up to 10 reply button titles (3 show as buttons, more as a list); no commas |

### POST /messages/media

An attachment with an optional caption, inside the 24-hour window.

| Field | Required | Description |
|-------|----------|-------------|
| `to` | yes | Number(s) |
| `url` | one of url / file | Public link ending in the file extension |
| `file` | one of url / file | Upload (multipart), up to 16 MB |
| `caption` | no | Up to 1024 characters |

Allowed types: jpg, jpeg, png, webp, mp4, 3gp, pdf, doc, docx, xls, xlsx, ppt, pptx, txt, csv.

### GET /messages/{id}

Status of a message sent through the API by this account (`id` from the send response).
Response: `{"message": <message object>}`; 404 `message_not_found`.

```bash
curl https://wa.jscoretech.com/api/v2/messages/6b1d7c8e-3f0a-4c55-9a5e-1d2f3a4b5c6d -H "X-API-Key: YOUR_API_KEY"
```

---

## 2. Legacy API v1

`POST https://wa.jscoretech.com/api/secure/v1/{action}/`

The original API (old `waapi/api.php`). It accepts a JSON body; the non-sending actions also read form fields and the query string.

**Authentication (sending actions):** `access_key` (the API key) **or** `username` + `password` of the panel login, in the body.

**Response:** `{"status": "200", "message": "Success", "result": {"id": "…", "status": "Success"}}`

Errors repeat the code in the message, e.g. `{"status":"202","message":"202 : Invalid Username","result":{"id":"0","status":"Invalid Username"}}`.

| status | message |
|--------|---------|
| `"200"` | Success: the message is queued (or sent at once with `bot: "1"`) |
| `"202"` | Invalid Username: wrong `access_key` or `username` / `password` |
| `"207"` | User WA Plan Expired |
| `"208"` | Template Message Limit Reached |
| `"209"` | Template Category Not Allowed |
| `0` | Invalid Request (unknown action) |

### send_message (alias create_wa)

| Field | Description |
|-------|-------------|
| `receiverMobileNo` | One number, comma-separated numbers or an array |
| `message` | The text |
| `filePathUrl` | Array of public file links to attach |
| `base64File` | Array of base64 files (stored and attached) |
| `bot` | `"1"` = send at once; otherwise the message waits for the sender queue |
| `opt` | `"1"` = authentication (OTP) message, sent at once |
| `type` / `message_type` | Overrides the message type (default `text`) |
| `messageButtons`, `title` | Reply buttons as `["Yes,No"]` with a title |
| `template`, `template_parameters`, `urlButtons` | Template name, body values (array or comma-separated), dynamic URL button value |
| `msg_values` | Any extra values stored with the message |
| `sheet_id` | Google Sheet reference |

```bash
curl -X POST https://wa.jscoretech.com/api/secure/v1/send_message/ \
  -H "Content-Type: application/json" \
  -d '{"access_key":"YOUR_API_KEY","receiverMobileNo":"919876543210","message":"Hello","filePathUrl":[],"bot":"1"}'
```

`result.id` is the message id for `status_wa`.

### send_template

Same authentication. Fields: `receiverMobileNo`, `template`, `template_parameters`, `attachment` (header media URL), `urlButtons`, `bot`.
The message is grouped into the campaign named after the template. `result.id` is always `"0"`.

### status_wa

`{"message_id": "<result.id of send_message>"}` → `result` = delivery status (`sent`, `delivered`, `read`, `error` …), or `null`.

### Google Sheet add-on

| Action | Fields | Result |
|--------|--------|--------|
| `sheet_activate` | `userEmail`, `sheetId`, `sheetType` | status 1 "Sheet Successfully Activated" / "Sheet Already Active"; 0 or 1001 "Invalid Email ID" |
| `sheet_status` | `userEmail`, `sheetId` | status 1 "Sheet is Active" with `result.user_email`; 0 "Sheet Not Active" |
| `create_log` | anything (`userEmail`, optional `Api-Key` header) | Stores the request in `js_api_data_log`; status 1 |

### Data Extractor activation keys

`check_js_de`, `activate_js_de`, `deactivate_js_de` with `key` (query or body). Plain-text answers: `OK`, `Invalid Activation Key`,
`Activation Key Already Login`.

---

## 3. Legacy URLs

Kept so existing clients and the Meta app configuration keep working.

| URL | Same as |
|-----|---------|
| `GET/POST /waapi/api.php?at={action}` | `/api/secure/v1/{action}/` |
| `GET/POST /wa/secure/v1/{action}-{anything}` | `/api/secure/v1/{action}/` (the part after the first `-` is ignored) |
| `POST /waapi/client_api.php?at=send_wa` | `send_template`; when `CLIENT_API_KEY` is set on the server, the `Api-Key` header must match (else `{"status":"0","msg":"Invalid credential"}`) |
| `POST /waapi/shopify.php?at={new_order\|abandoned_cart}` | `/api/shopify/v1/{action}/` |
| `/waapi/webhook`, `/waapi/webhook.php`, `/waapi/wawebhook.php` | Meta WhatsApp webhook |
| `/waapi/igwebhook.php`, `/waapi/newwebhook.php` | Instagram webhook (log and acknowledge) |

---

## 4. Leads CRM webhook

`https://wa.jscoretech.com/api/crm/{key}`: the key and verify token are shown in the user panel under **CRM → Settings**
(accounts with CRM switched on).

| Method | Description |
|--------|-------------|
| `GET` | Without `hub.*`: `{"ok": true, "message": "The CRM webhook is ready. POST leads to this URL."}` |
| `GET ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` | Facebook verification: returns the challenge when the token matches, else 403 |
| `POST` | Add leads (JSON, form-urlencoded or multipart, up to 256 KB) |

The body can be one lead, an array, `{"leads": [ … ]}` (up to 100) or `{"data": { … }}`. Field names are matched case-insensitively:

| Lead field | Accepted keys |
|------------|---------------|
| Name | `name`, `full_name`, `customer_name`, `lead_name`, `contact_name`, or `first_name` + `last_name` |
| Mobile | `mobile`, `phone`, `phone_number`, `mobile_number`, `whatsapp`, `contact_number`, `number`, `tel` |
| Email | `email`, `email_address`, `mail` |
| Source | `source`, `lead_source`, `platform`, `utm_source`, `channel` (default `website`) |
| Campaign | `campaign`, `campaign_name`, `ad_name`, `adset_name`, `form_name`, `utm_campaign` |
| Notes | `message`, `notes`, `comments`, `remarks`, `query`, `requirement`, `description` |

Other keys are saved as extra lead fields. Facebook Lead Ads notifications (`"object": "page"`, field `leadgen`) are also accepted:
the answers are read from the Graph API with the saved Page token. When a Facebook app secret is saved, `X-Hub-Signature-256` is checked.

```bash
curl -X POST https://wa.jscoretech.com/api/crm/YOUR_CRM_KEY \
  -H "Content-Type: application/json" \
  -d '{"name":"Ravi Kumar","mobile":"919876543210","email":"ravi@example.com","source":"website","message":"Please call me"}'
```

Response: `{"ok": true, "saved": 1, "duplicates": 0, "lead_ids": [123]}`. Errors: 404 unknown key, 400 bad body, 403 invalid signature,
413 body too large, 422 no name / mobile / email.

---

## 5. Webhooks and callbacks

These are called by other services. Do not send test payloads to production: they create real inbox messages, leads or payments.

### Meta WhatsApp webhook: `/waapi/webhook`

- **GET**: subscription handshake. Returns `hub.challenge` when `hub.verify_token` equals `META_WEBHOOK_VERIFY_TOKEN` or any account's API key; 403 otherwise.
- **POST**: incoming messages, delivery statuses and call events from the WhatsApp Cloud API. `X-Hub-Signature-256` (sha256 HMAC of the raw
  body with `META_APP_SECRET`) is checked (401 if wrong). Always answers `{"status":"200","msg":"1"}`; the inbox, auto-replies, bot flows and
  forwarding to the account's own webhook URL run after the response.

### Meta Lead Ads webhook: `/integrations/meta/webhook`

Agency Meta app, Page object, field `leadgen` (Settings → Meta Lead Ads Keys).
- **GET**: handshake with the Lead Ads verify token.
- **POST**: `X-Hub-Signature-256` is required (401 otherwise). Each `leadgen_id` is stored once and answered `EVENT_RECEIVED`; the lead is read
  after the response and retried by the `meta-leads` job.

### Shopify: `/api/shopify/v1/{action}/`

| action | Shopify webhook | Template sent |
|--------|-----------------|---------------|
| `new_order` | Order creation | `SHOPIFY_ORDER_TEMPLATE` (default `order_confirmation`), parameters: customer name, order number |
| `abandoned_cart` | Checkout | `SHOPIFY_CART_TEMPLATE` (default `abandoned_checkout`); the URL button gets the path + query of `abandoned_checkout_url` |

Sent from account `SHOPIFY_USER_ID` (default 74) to `phone` or `billing_address.phone`. `X-Shopify-Hmac-Sha256` is checked when
`SHOPIFY_WEBHOOK_SECRET` is set. Response: `{"data":{"id":"0","status":"Success"},"msg":"Success","status":"200"}`; `"201"` when the
phone is missing or the template is not configured; `"401"` for a wrong signature.

### CCAvenue: `POST /payment/ccavenue/callback`

Return / cancel URL of CCAvenue. Form field `encResp` (encrypted with the CCAvenue working key). The payment is matched by order number and
amount, the plan is activated on success, and the browser is redirected (303) to `/payment/result`.

---

## 6. Outgoing: CRM WA API

Not an endpoint of this project: the API this app calls to send the daily **11:00 AM** report (Settings → CRM WA, super admin).
It is listed so the configuration can be tested from Postman.

```
POST https://crm.jscoretech.com/api/secure/v1/send_message/
x-api-key: <Settings → CRM WA → x-api-key>
Content-Type: application/json
```

```json
{
  "receiverMobileNo": "",
  "recipientGroupIds": "120363431942002851@g.us",
  "message": "*WA Panel*\nUsers Expiring in Next 7 Days\n\n1. Ravi Kumar (Acme) - 28-11-2026",
  "filePathUrl": "https://wa.jscoretech.com/media/reports/<image>.png",
  "bot": "1",
  "base64File": [],
  "sheetid": ""
}
```

Two reports are sent, each only when it has users: accounts expiring in the next N days (default 7) and accounts with a sending limit
that have N% or less left (default 20%). Each page of up to 25 users is one message with a PNG table (`filePathUrl`).

---

## Appendix: panel endpoints (not public APIs)

These routes serve the web panel itself. They need the browser login session (user panel or `/wamaster` admin) and are not meant for
integrations, so they are not in the Postman collection.

| Area | Routes |
|------|--------|
| User inbox | `/chat/conversations`, `/chat/thread`, `/chat/poll`, `/chat/send`, `/chat/template` |
| User exports / samples | `/campaigns/{id}/export`, `/contacts/export`, `/contacts/sample`, `/crm/export`, `/flow_responses/export`, `/incoming/export`, `/incoming_attachment/export`, `/reports/export/{type}`, `/reports_templates/export`, `/reports_templates_summary/export`, `/bot_flows/{id}/sessions/export`, `/compose/sample` |
| User helpers | `/compose/count_file`, `/groups/{id}/contacts`, `/templates_content`, `/crm/reminders`, `/bot_flows/upload`, `/user_update`, `/view_attachment/{id}`, `/api_docs/postman` (hidden for now) |
| Admin | `/wamaster/users/export`, `/wamaster/media/export`, `/wamaster/meta_leads/leads/export`, `/wamaster/reports/messages/{type}/export`, `/wamaster/reports/templates/export`, `/wamaster/backups/download`, `/wamaster/fb_posts/sample`, `/wamaster/settings/crm_wa/preview`, `/wamaster/view/user`, `/wamaster/view/user/{page}`, `/wamaster/view/masters` |
| Other | `/media/{path}` (uploaded files), `/logout`, `/wamaster/logout` |
