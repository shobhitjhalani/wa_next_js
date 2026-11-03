# Admin panel (`/wamaster`) — migration notes

PHP source: `wamaster/` (dashboard, profile, change_password, `view/**`, `classes/*`).
New code: `src/app/wamaster/(panel)/**`, `src/components/admin/*`, `src/lib/admin/*`.
Test: `scripts/test-admin-pages.sh` (116 checks against the dev server; cleans up after itself).

## URLs

The PHP URLs are kept, without `.php` and without the `?session=` parameter:

| PHP | Next.js |
|---|---|
| `/wamaster/` (login), `/wamaster/logout` | same |
| `/wamaster/dashboard`, `/profile`, `/change_password` | same |
| `/wamaster/view/user/index.php?ut=2` | `/wamaster/view/user?ut=2` |
| `/wamaster/view/user/{add,view,recharge,emails}?ut=&id=` | same |
| `/wamaster/view/masters/index.php?h=82`, `/masters/add?h=&id=` | `/wamaster/view/masters?h=82`, same |
| `/wamaster/view/teams/{index,add,view}` | `/wamaster/view/teams`, same |
| `/wamaster/view/reports/<name>` | same (`reports/index` redirects to `wa_send`) |
| `/wamaster/view/user/status?...` (GET that changed data) | replaced by POST form actions |

Redirects still needed in `next.config.ts` (the generic `*.php` rule turns `.../index.php` into `.../index`):

```ts
{ source: "/wamaster/view/:section/index", destination: "/wamaster/view/:section", permanent: true },
{ source: "/wamaster/view/user/status", destination: "/wamaster/view/user", permanent: false },
```

## Deliberate changes

- **Data changes need a POST.** PHP changed status, deleted rows and refreshed users through plain
  GET links (`user/status?...`, `masters/delete`), which any page could trigger (CSRF). All of these
  are now server actions (POST, same-origin checked by Next.js), with a confirm dialog where PHP had one.
- **Authorisation is enforced on the server for every page *and* action.** Super-admin pages
  (`fun_check_admin`, m_type 4) redirect others to the dashboard; non-super admins only see users with
  `u_assign_to = their emp_id`, as in PHP, but this is now also applied to every report, every bulk action,
  and to opening a user by id (PHP's user pages and several reports did not check it).
  `getAdmin()` also re-checks that the employee is still active (PHP trusted the session until it expired).
- **Rights** (`fun_check_rights`) are ported in `src/lib/admin/rights.ts` and used for user add/edit/delete
  and masters. The PHP rights-editing UI (`get_rights` AJAX) no longer existed, so there is none here.
- **Passwords** are bcrypt (`hashPassword`) for user add/edit, team members and change password; existing
  PHP hashes still log in and are upgraded (see `src/lib/password.ts`).
- **Filters are in the URL (GET)** instead of `$_SESSION` after a POST, so a filtered report can be
  bookmarked or shared. `?s=false` (reset) is not needed any more.
- **Exports are real `.xlsx` files** (exceljs) instead of an HTML table served as `.xls`; capped at 100,000 rows.
- **Counting rows:** PHP `fun_select_page` fetched every matching row just to count them; now `COUNT(*)` +
  `LIMIT/OFFSET`. Report header counters now use the same filters as the table (PHP ignored some).
- **Recharge:** the incoming-plan branch (`plan type 1`) only ran when no payment source was given (an
  `elseif` attached to the wrong `if`); fixed. `ur_year` is set explicitly. `F_YEAR` is still `"23-24"`
  as in PHP, overridable with `FINANCIAL_YEAR`.
- **User view** shows the real AI flag (PHP printed the catalogue flag under "AI").
- **Catalogue section title / misc:** values are stored as typed; the `&#39;`/`&#34;` escaping PHP applied
  before saving is no longer added (old escaped values are still decoded when shown).
- **Masters:** `add.php` (816 lines) had special form layouts per heading id. The port is config-driven
  (`masterLayout()` in `src/lib/admin/masters.ts`): plans (82), states (43), cities (44), documents (98),
  cron jobs (104), and a generic Title/Code/Description/Value form for the rest. Rare headings such as
  categories (12/13/76) with tree parents are **not** specially handled yet.
- **`js_master_heading`** is missing from the local `wa_official` copy (it is in `wa_js`). The menu and masters
  pages fall back to a built-in copy of its rows; when the production dump brings the table, it is used instead.
- **Legacy reports** `reports/error`, `wa_users`, `users`, `gs_users`: PHP filtered on `m_msg_type = '1'` /
  `m_source`, values no current message has, so they were empty. They now count all outgoing messages.
- **Not ported:** `view/blank/*` (page templates), `wamaster/script/*` (one-off fix scripts),
  `user/custom_fields.php` (AJAX field toggles — now done in the form component), `user/send_wa.php`
  (no link to it in the admin UI), team photo/document upload (the form had no file inputs).

## Columns that exist in PHP code but not in the local schema

`u_wa_coexistence` (user add/view "Coexistence") — not in the migrated `js_user`, so the switch is not shown.
Add it after the production dump confirms it exists.

## Performance

Unfiltered `wa_send` / `wa_failed` take ~6 s locally: each `COUNT(*)` scans the 2.8 GB `js_message` table
(only single-column indexes exist). Suggested indexes, to be added together with the other schema work:

```sql
CREATE INDEX CONCURRENTLY js_message_out_status ON js_message (m_status, m_id DESC) WHERE m_is_incoming = 2 AND m_dstatus = 0;
CREATE INDEX CONCURRENTLY js_message_out_failed ON js_message (m_id DESC) WHERE m_is_incoming = 2 AND m_dstatus = 0 AND m_delivery_status = 'failed';
```
