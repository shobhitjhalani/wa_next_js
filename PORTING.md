# Porting guide: Laravel `wa_js` → Next.js `wa_next_js`

The Laravel app lives at `/Applications/XAMPP/xamppfiles/htdocs/wa_js`. Port each controller + Blade view
**with the same behaviour, URLs, form fields, labels, validation messages and markup classes** (the same Velzon
Bootstrap 5 theme CSS is loaded, so copying the Blade HTML structure keeps the look identical). Make it faster
where you can (fewer queries, set-based SQL, no N+1), but don't change what the user sees or can do.

**Before writing code, read the Next 16 docs you need in `node_modules/next/dist/docs/`** (this Next version has
breaking changes: `params`/`searchParams` are Promises, `middleware` is `proxy`, etc.).

## Stack

- Next.js 16 App Router, React 19, TypeScript, `cacheComponents: false` → pages are dynamic per request.
- PostgreSQL via `pg` (`src/lib/db.ts`). Same `js_*` tables and column names as MySQL; schema: `db/schema.sql`.
- No ORM. Hand-written SQL with `$1…$n` params. **Never interpolate request values into SQL.**

## Directory map

```
src/app/(guest)/page.tsx            "/" user login  (reference: actions.ts next to it)
src/app/(user)/layout.tsx           user panel frame + requireUser(); put user pages under src/app/(user)/<url>/page.tsx
src/app/wamaster/page.tsx           admin login
src/app/wamaster/(panel)/layout.tsx admin frame + requireAdmin(); admin pages under src/app/wamaster/(panel)/<url>/page.tsx
src/lib/…                           shared, see below
src/components/…                    shared UI, see below
```

URL mapping = Laravel routes (`routes/web.php` in wa_js). Laravel `PUT`/`DELETE` form routes become Server Actions.
GET endpoints returning JSON/HTML fragments/files (exports, chat polling, attachments) become `route.ts` handlers at
the same URL. A page and a route handler can't share a path segment — e.g. `/contacts/export` is a `route.ts` in
`src/app/(user)/contacts/export/`.

## Shared library (use these; don't re-implement)

| Module | What |
|---|---|
| `lib/db.ts` | `query`, `one`, `value`, `exec`, `tx`, `insert`, `insertMany`, `update`, `cursor`, `like()` (escape LIKE input), `placeholders()`. bigint/numeric come back as `number`; `timestamp` columns as `"Y-m-d H:i:s"` strings. |
| `lib/auth.ts` | `requireUser()`, `requireAiUser()`, `getUser()`, `requireAdmin()`, `requireAdminCan('masters'\|'employee'\|'super')`, `getAdmin()` (`.isSuperAdmin`), `clientIp()`. Request-cached. |
| `lib/actions.ts` | `flash(type, msg)`, `ActionResult`, `ok()`, `fail()`, `invalid(errors)`, FormData readers `fStr fRaw fInt fBool fAll fInts fFile fFiles fileExt isEmail`. |
| `lib/config.ts` | `config` (= Laravel `config('wa.*')`, camelCased: `config.queTime`, `config.masters.waPlan`, `config.messageStatus`, `config.payment.*`, …), `url(path)` absolute URL. |
| `lib/time.ts` | `now()` (unix s), `dayStart()`, `monthStart()`, `addDays()`, `phpDate(fmt, ts)` (PHP `date()`), `parseDate()` (`strtotime` for d-m-Y / Y-m-d / datetime-local), `parseDateRange()` (= `DateRange::parse`, end exclusive), `todayString()`, `shortTime()`, `timestampToUnix()`. |
| `lib/text.ts` | `decodeEntities` (html_entity_decode), `limit` (Str::limit), `ucfirst`, `numberFormat` (number_format), `randomString`, `jsonParse`, `str`, `int`. |
| `lib/format.ts` | Pure row helpers (client-safe): `messageSummary`, `messagePreview`, `messageStatusLabel`, `isErrorMessage`, `mediaInfo`, `contactDisplayName/Initials/WindowLeft`, `templateButtons/Cards/Variables/ParameterCount`, `countVariables`, `campaignTitle/GroupIds/IsTracked/SendAt/StatusLabel`. |
| `lib/models.ts` | `contactId()`, `recordMessage()`, `refreshUnread()`, `blockNumber()`, `masterOptions(type)` → `{value,label}[]`, `masterCodeOptions`, `masterName`, `employeeCanAccess()`. |
| `lib/phone.ts` | `normalizePhone`, `parsePhoneList`, `internationalise`, `fromWaId`. |
| `lib/password.ts` | `checkPassword` (bcrypt + legacy sha1), `hashPassword`, `needsUpgrade`, `safeEqual`. |
| `lib/whatsapp-text.ts` | `waToHtml(text)` (= `WhatsAppText::toHtml`, already escaped → `dangerouslySetInnerHTML`). |
| `lib/http.ts` | `csvResponse(filename, header, sql, params, mapRow)` streamed CSV export, `csvFromRows`, `sp(params,key)`, `spAll`. |
| `lib/types.ts` | Row interfaces: `UserRow`, `EmployeeRow`, `MessageRow`, `ContactRow`, `TemplateRow`, `CampaignRow`, `CampaignStats`, `GroupRow`, `MasterValueRow`, `RechargeRow`, `PaymentLogRow`, consts `USER_TYPE`, `CAMPAIGN`, `SUPER_ADMIN`. |
| `lib/services/meta.ts` | Graph API: `sendMessage`, `fetchTemplates`, `createTemplate`, `uploadSample`, `mediaInfo`, `downloadMedia`, `registerNumber`, `subscribeApp`, `metaGet/metaPost`. |
| `lib/services/sender.ts` | `sendPending(messageId?, userId?)`, `sendNow(id)`, `claimAndSend()`, `templateParameters()`. |
| `lib/services/messages.ts` | `UserError` (message for the user), `templateFields`, `queueMessages`, `chatReply`, `messageFromApi`, `storeIncoming`, `insertMessage`, `HEADER_UPLOADS`. |
| `lib/services/campaigns.ts` | `createCampaign`, `dispatchCampaign`, `dispatchDueCampaigns`, `cancelCampaign`, `audience`, `campaignStats(rows, withReplies)`. |
| `lib/services/templates.ts` | `syncTemplates(user)`, `createStandardTemplate`, `createCarouselTemplate` (+ input types). |
| `lib/services/plans.ts` | `listPlans`, `findPlan`, `payableAmount`, `outstanding`, `gstOf`, `startPayment`, `recharge(userId, plan, details)`, `expirePlans`. |
| `lib/services/reports.ts` | `templateMatrix({userId, from, to, byUser, types})`, `buildMatrix`, `adminSummary`, `userTemplateReport`, `Matrix`, `TEMPLATE_TYPES`, `naturalCompare`. |
| `lib/services/contacts-import.ts` | `importContacts(userId, {bytes, extension}, groupId, overwrite)`, `ImportError`. |
| `lib/services/media.ts` | `storePublic(file, folder)` → absolute URL under `/media`, `storeBytes`, `mediaDir`. |
| `lib/services/webhook.ts` | `handleWebhook(payload, defer)`, `processStatusQueue()`. |
| `lib/services/mailer.ts` | `sendMail({to, bcc, subject, html})`. |

Shared components: `components/PageTitle.tsx` (**every panel page renders `<PageTitle title="…" home="/dashboard" />`
first** — breadcrumb + flash alert; admin pages use `home="/wamaster/dashboard"`), `components/ActionForm.tsx`
(`ActionForm`, `FieldError`, `SubmitButton`, `FormAlert`, `useActionForm`), `components/ui.tsx` (`DateRangeInput`,
`SelectAll`, `ConfirmButton`, `PasswordInput`, `modal(id)`, `bootstrap()`), `components/Pagination.tsx`
(`Pagination`, `pageParam`), `components/StatusMatrix.tsx`.

**Do not edit existing shared files** (other people are working in parallel). If you need a new shared helper, add a
new file (e.g. `src/lib/reports-user.ts`, `src/components/admin/UserTabs.tsx`). If you find a bug in a shared file,
work around it locally and report it in your final message.

## Patterns

### Page (Server Component)

```tsx
// src/app/(user)/groups/page.tsx
import { requireUser } from '@/lib/auth';
import { query, like } from '@/lib/db';
import { sp } from '@/lib/http';
import { PageTitle } from '@/components/PageTitle';

export default async function GroupsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();          // the layout also checks, but always scope queries by user.u_id
  const params = await searchParams;
  const q = sp(params, 'q');
  const groups = await query<{ ug_id: number; name: string; contacts: number }>(
    `SELECT g.ug_id, g.up_group_name AS name, COUNT(gc.id)::int AS contacts
       FROM js_user_groups g LEFT JOIN js_user_groups_contact gc ON gc.group_id = g.ug_id
      WHERE g.ug_user_id = $1 AND g.ug_dstatus = 0 AND ($2 = '' OR g.up_group_name ILIKE '%' || $2 || '%')
      GROUP BY g.ug_id ORDER BY g.up_group_name`, [user.u_id, like(q)]);
  return (<>
    <PageTitle title="Groups" home="/dashboard" />
    {/* markup copied from resources/views/user/groups/index.blade.php, class → className */}
  </>);
}
```

- Run independent queries in parallel with `Promise.all`.
- Tables with many rows (`js_message` 3.5M+, `js_user_contact_list`): always filter by user + indexed columns
  (see indexes in `db/schema.sql`); paginate with `LIMIT/OFFSET` and a separate `COUNT(*)` only when Laravel showed
  totals. Use `COUNT(*) FILTER (WHERE …)` to compute several counts in one scan.
- MySQL `LIKE` was case-insensitive → use `ILIKE` in PostgreSQL (with `like(input)` escaping). Columns
  `u_username, u_email_id, emp_username, emp_email_id, ue_email_id, up_group_name, c_keyword` are `citext`
  (case-insensitive `=`).
- MySQL `!= ''` excluded NULLs; in PostgreSQL write `COALESCE(col, '') <> ''` when NULL is possible.
- `SUM(cond)` → `COUNT(*) FILTER (WHERE cond)`; `IFNULL` → `COALESCE`; backtick quotes → none;
  `GROUP_CONCAT` → `string_agg`; `FIND_IN_SET` → `= ANY(string_to_array(…))`.
- Cast `COUNT(*)::int` (or rely on the bigint→number parser).

### Mutations: Server Actions

Put them in `actions.ts` next to the page, with `'use server'` at the top. **Every action re-checks auth**
(`requireUser()` / `requireAdmin()` / `requireAdminCan()`) and ownership (`WHERE … AND x_user_id = $user`) —
actions are public HTTP endpoints.

Simple forms (delete / toggle / small updates) — plain `<form action={fn}>` with hidden inputs; the action does
the work, `await flash('success', '…')`, then `revalidatePath('/groups')` or `redirect('/groups')`
(Laravel `back()->with('success', …)`). Bind ids with `.bind(null, id)` or hidden inputs.

Forms with validation that must keep the typed input — `<ActionForm action={fn}>` (client component) whose action has
signature `(prev: ActionResult | null, fd: FormData) => Promise<ActionResult>`; return `invalid({field: msg})`,
`fail('message')`, or `ok('Saved')`, or `flash()` + `redirect()` on success. Laravel validation messages: copy the
default English wording (`The name field is required.`) or the custom ones from the controller.

Confirmation prompts (legacy `onclick="return confirm(…)"`): `<ConfirmButton message="Delete?">` inside the form, or
`<ActionForm confirm="…">`.

### Client components

Anything that used jQuery / inline `<script>` in Blade becomes a small `'use client'` component (keep it focused;
pass server data as props). Modals: Bootstrap markup with `data-bs-toggle="modal"` works as-is (Bootstrap JS is loaded
globally); programmatic: `modal('id')`. Date range filters: `<DateRangeInput name="dt_search" defaultValue={…} />`.
"Select all" checkboxes: `<SelectAll target=".row-check" />`. Polling: `setInterval` + `fetch` to a route handler.

### Route handlers (`route.ts`)

For downloads/exports/JSON/polling. Check auth with `getUser()`/`getAdmin()` and return 401/redirect when null.
CSV exports: `csvResponse(...)` streams from a cursor. `params` is a Promise: `ctx: { params: Promise<{ id: string }> }`.

### Markup

Copy Blade HTML: `class`→`className`, `for`→`htmlFor`, `{{ $x }}`→`{x}`, `@foreach`→`.map`, `@if`→`&&`/ternary,
`{!! … !!}`→`dangerouslySetInnerHTML` (only for already-escaped HTML like `waToHtml`), `old('x')` → handled by
ActionForm keeping input, `route('user.x')` → literal path, `number_format` → `numberFormat`,
`date('d-m-Y H:i', $ts)` → `phpDate('d-m-Y H:i', ts)`, inline `style="a:b"` → `style={{ a: 'b' }}`, self-close void
tags, `checked`/`selected` → `defaultChecked`/`defaultValue`. Links → `next/link` `<Link>`.

## Verifying

- Typecheck only your files: `npx tsc --noEmit 2>&1 | grep -E "src/app/\(user\)/contacts"` (others are editing too).
- A dev server is already running on **http://localhost:3100** (do **not** start another one or run `next build`).
  Get a session cookie: `C=$(npx tsx scripts/dev-session.ts --user=74)` (or `--admin=1`), then
  `curl -s -b "$C" http://localhost:3100/contacts | grep -o 'Some text'`. Server errors appear in the HTML
  (look for `Error`/`digest`) and in `/private/tmp/claude-502/-Applications-XAMPP-xamppfiles-htdocs-wa-js/18a6c3f4-9af6-4073-a7f8-c4c43f97c057/scratchpad/dev.log`.
- Data is real (copied from MySQL): user 74 is a busy WhatsApp account; `psql -d wa_next` to inspect.
  `js_message` may still be loading for the first few minutes.
- **Never call the real Meta / Razorpay / CCAvenue APIs and never send messages** while testing (don't submit forms
  that queue or send WhatsApp messages; don't run the worker). Read-only checks + reversible writes on test rows only.
