# Partner APIs (waapi/api.php, client_api.php, shopify.php)

Code: `src/lib/api/*`, routes `src/app/api/legacy/{api,client,shopify}/route.ts`, URL rules in `next.config.ts`.
Test: `npx tsx scripts/test-api.ts` (dev server on :3000; mock WhatsApp API, no external calls).

## URLs kept
| Old URL | Handler |
|---|---|
| `/api/secure/v1/<at>/` (and without the slash) | api.php |
| `/wa/secure/v1/<at>-<uk>/` (split on the last `-`, like Apache) | api.php |
| `/waapi/api.php?at=<at>` | api.php |
| `/waapi/client_api.php?at=<at>` | client_api.php |
| `/api/shopify/v1/<at>/`, `/waapi/shopify.php?at=<at>` | shopify.php |

`skipTrailingSlashRedirect` is on: Next.js would otherwise 308-redirect `/api/secure/v1/x/`,
and API clients (PHP curl, Apps Script) don't re-POST redirects. Pages still drop a trailing
slash via an explicit redirect rule.

## Same as PHP
- Response envelopes, messages and the mixed int/string `status` values are unchanged.
- Saved values still have `'` and `"` replaced with `&#39;`/`&#34;` (the sender and UI decode them).
- Auth (`fun_user_data`): `access_key` (= `u_access_code`) or username + password. Passwords
  work with both the legacy PHP hash and the bcrypt hash written after a web login.
- `bot=1` rows are created at status 6 and sent during the request; everything else is queued
  (status 1) for the worker.
- `check_js_de` answers `OK` for any valid key (PHP used `=` instead of `==`); `deactivate_js_de`
  prints nothing on success.

## Deliberate changes
- **Deleted users** (`u_dstatus = 1`) can no longer authenticate; PHP didn't check it.
- **`incoming`** (the old non-Meta gateway) returns `Invalid Request`. PHP called the missing
  `fun_save_incoming()` and crashed. Meta inbound goes through the webhooks.
- **`get_group` / `update_group`** return status `501`. Group messaging belonged to the retired
  gateway; PHP crashed (missing `fun_get_groups`) or queued an unsendable row.
- **`client_api.php` `create_bot`** returns `501`: `fun_create_update_user_bot()` doesn't exist
  in this codebase (PHP crashed).
- **`client_api.php` key** now comes from `CLIENT_API_KEY` (it was hard-coded). **Set it in
  production to the old value** from `waapi/client_api.php`, or partners get "Invalid credential".
- **Shopify**: user id comes from `SHOPIFY_USER_ID` (default 74). If `SHOPIFY_WEBHOOK_SECRET` is
  set, `X-Shopify-Hmac-Sha256` is verified; PHP accepted anything.
- **`filePathUrl`** given as a string (not an array) is kept. PHP's `implode()` returned null, so
  it was silently dropped.
- **Contacts** are only created for a single mobile number. A comma-separated `receiverMobileNo`
  gets contact id 0, which is what PHP effectively did (its query failed).
- **API log** (`log.js_api_data_log`): `adl_url` = action, `adl_value` = payload. PHP passed the
  arguments in the wrong order, so it logged "2" and the action name.
- Responses are sent as `application/json` (PHP sent `text/html`).

## Schema drift
`js_message.m_unique_id` (written by create_wa/send_message, read by status_wa) is missing from
the old local MySQL copy. Added in `scripts/migrate/schema-drift.sql` and in `prisma/schema.prisma`.

## Known PHP behaviour kept as-is
- Several numbers in one `receiverMobileNo` become one row (`"a,b"`), which Meta then rejects.
- `create_wa_reply` and `create_wa_test` queue type `"1"`, which the sender doesn't handle
  (the message ends Cancelled), unless the body sets `type`.
