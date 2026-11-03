# User panel — migration notes

Port of the root `*.php` pages of the PHP app (everything except login, `waapi/`, `cron/`).
Pages live in `src/app/(user)/`, logic in `src/lib/user/`, markup pieces in `src/components/user/`.
Test: `scripts/test-user-pages.sh` (79 checks against the dev server, own test user, no external calls).

## Routes

| PHP | Next.js | Notes |
|---|---|---|
| dashboard.php | `/dashboard` | Facebook Embedded Signup kept. "Total Msg Send" stays 0 and the template/day summaries stay hidden — their queries are commented out in the PHP too. |
| que.php | `/que` | |
| reports.php | `/reports` | Export button was commented out in PHP; not shown. |
| reports_failed.php | `/reports_failed` | Bulk Delete / Resend, Export. |
| reports_error.php | `/reports_error` | Bulk Delete / Resend, Export. |
| reports_templates.php | `/reports_templates` | |
| incoming.php / incoming_attachment.php | `/incoming`, `/incoming_attachment` | |
| view_attachment.php | `/view_attachment?id=` | |
| templates.php | `/templates` | |
| templates_add.php | `/templates_add` | Delete moved to a POST button on `/templates`. |
| templates_content.php | `/templates_content?id=` | Returns JSON; the compose form renders preview + inputs. |
| compose.php | `/compose` (`?tm=`, `?mb=`) | |
| create.php | `/create` | See "not available" below. |
| scheduler.php | `/scheduler` | Unlinked copy of compose; now queues like compose. |
| chat.php, chat_mobile_list.php, chat_message.php, save_msg.php | `/chat`, `/chat_mobile_list`, `/chat_message`, `/save_msg` | The helper URLs return JSON instead of HTML fragments. |
| knowledge_base.php, prompts.php, do_dont.php | same names | |
| wa_plans.php | `/wa_plans` | |
| paycca.php | `/paycca?pl=` | payr.php (Razorpay) not ported |
| success.php | `/success?pl=` + `/payment/ccavenue` (CCAvenue callback) | |
| recharge.php | `/recharge` | |
| user_update.php | `/user_update` | |
| send_wa.php | `/send_wa` (POST) | |
| whatsapp.php | `/whatsapp` | Info page only (see below). |
| js.php | client components | `ComposeForm`, `ChatApp`, `AttachmentInputs`, `DoDontLists`, `ConfirmSubmit`. |
| — | `/export_messages?type=1\|2\|3` | Excel export used by the report pages. |

**Skipped** (test/scratch or empty files): `test_ai.php`, `test_script.php`, `facebook_ads_test.php`,
`fb.php`, `fb_messenger.php`, `mis_index.php`, `signup.php` (empty), `reports_send.php` (empty).
`includes/notifications.php` is commented out in the PHP header, so it is not ported.

## Deliberate changes

Security:
- Every query is scoped to the signed-in user. The PHP trusted request ids in several places:
  marking incoming messages read, editing a template (`ut_id` only), viewing an attachment.
- Actions that change data are POSTs: server actions, or route handlers that check the Origin header.
  The PHP used GET links for resend (`send_wa`) and template delete.
- CCAvenue: only `order_status=Success` counts (PHP also accepted `Initiated`). The paid amount must
  match the payment log, and a payment is credited only once (replays are ignored).
- Payment state lives in `log.js_payment_log`, not the session. The CCAvenue callback is a
  cross-site POST, which a SameSite cookie would not survive.

Bugs fixed:
- CCAvenue success passed the order number (`PL-…`) as the plan id to `fun_updated_user_plan`,
  so validity was never extended and `ur_plan_id` was 0. The plan now comes from `p_order_no`.
  `ur_received_amount` is also filled in now (it was always 0).
- Template sync (`fun_get_templates_meta`):
  - Templates are only hidden after Meta actually answers. PHP set every template to status 2
    first, so a failed call emptied the list.
  - All result pages are read (PHP read only the first 25).
  - The `flow` type and body example no longer carry over from one template to the next.
  - Footers are saved; PHP compared against `footer` in lowercase while Meta sends `FOOTER`.
- `recharge.php` listed queued *messages* under recharge headings. It now lists `js_user_recharge`.
- `create.php` called `fun_create_template()`, which doesn't exist (fatal error). The page now
  renders, and submitting says the feature is not available yet.

Behaviour kept on purpose:
- Text is stored with `'` → `&#39;` and `"` → `&#34;`, as the PHP did, so rows stay readable by
  both apps during the transition. It is decoded for display.
- Synced templates are stored as status 1 (active) whatever Meta's status, as in PHP.
- Templates are re-synced from Meta on every visit to `/templates`, as in PHP.
- Compose rejects a second submit with the same `ucode` ("Duplicate Campaign").

Other:
- Filters are in the query string, not the session, so pages are linkable. Pager links keep them.
- Theme: `plugins.js` injected Choices/Flatpickr with `document.writeln` from the production
  domain. `ThemeScripts` loads the local copies in order and initialises them. Links are plain
  `<a>` (full page loads), like the PHP app.
- The Excel export is a real `.xlsx` (exceljs). PHP sent an HTML table named `.xls`.
- `ut_template_type` `'1'` (old local rows, `WA_OFFICIAL`) is queued as `template`. PHP would have
  written `m_msg_type = '1'`, which is never sent.
- `whatsapp.php` was the QR login of the old unofficial gateway (`WA_API_SOURCE` 1/2,
  `localhost:5000`). The Cloud API has no QR login, so `/whatsapp` only shows the connection state.
- PDF (mpdf): none of the user-panel pages use it.
- Payment gateway: CCAvenue only. The PHP also had an unused Razorpay branch (`payr.php`);
  it was not ported. The keys come only from env (`CCA_*`).

## Schema drift added (`scripts/migrate/schema-drift.sql`)

The local MySQL copy is older than the code.

| Change | Why |
|---|---|
| `js_user_templates.ut_parameters` (new) | body example JSON |
| `ut_template_type` → `varchar(25)` | production stores `'template'` / `'flow'` |
| `js_message.m_campaign_id` (new) | groups compose messages into a campaign |
| table `js_user_campaign` (new) | one row per compose submit (`uc_unique_code` unique) |

Check these against a production schema dump before cut-over.
