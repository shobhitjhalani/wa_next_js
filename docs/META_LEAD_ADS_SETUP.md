# Meta Lead Ads: setup

One Meta App and one System User token create a common lead ad for each client and bring every lead into that
client's Leads CRM. The admin page is **Meta Lead Ads** (`/wamaster/meta_leads`, super admins only).

## 1. Keys: Settings → Meta Lead Ads Keys (or `shared/.env` on the server)

The easiest way: **Settings → Meta Lead Ads Keys** (`/wamaster/settings/meta`, super admins). Paste the System User
token, the App secret and a verify token (Generate makes one) and save; the app and the worker use them within 30
seconds, no restart. Saved values are shown only by their last 4 characters, and the Activity Log records who changed
them (never the values). A value saved there is used instead of the `.env` one; "Remove" goes back to `.env`.
The App secret saved there only checks the Lead Ads webhook: the WhatsApp webhook is not affected.

Or in `.env`:

| Variable | What |
|---|---|
| `META_SYSTEM_USER_TOKEN` | The System User token (see 3). If empty, the User / System User token saved on *Facebook Posts → Pages* is used. |
| `META_APP_ID` | The Meta App id (falls back to `FB_APP_ID`). |
| `META_LEADS_APP_SECRET` | App secret of the Lead Ads app, used to check `X-Hub-Signature-256`. If the Lead Ads app **is** the WhatsApp app, you can leave this empty and set `META_APP_SECRET` instead. Setting `META_APP_SECRET` also turns on the signature check of the WhatsApp webhook `/waapi/webhook`, so only do that when both use the same app. Without either secret, every Lead Ads webhook is refused (401). |
| `META_WEBHOOK_VERIFY_TOKEN` | Any random string; type the same into the Meta App webhook settings (step 2). |
| `META_GRAPH_VERSION` | Optional, e.g. `v23.0`. Default: the version in `WA_API_URL` (now v25.0). |

Tokens are never written to logs, error texts or URLs (they are sent in the `Authorization` header).
Restart after changing `.env`: `pm2 reload wa-app --update-env && pm2 restart wa-worker --update-env` (the deploy script does this).

The worker (`wa-worker`) runs three jobs: `meta-provision` (every 30 s: creates queued ads, activates confirmed ones),
`meta-leads` (every 30 s: saves new leads and retries failed ones after 1, 5, 15 and 60 min, 5 tries) and
`meta-leads-backfill` (every 30 min: reads each form's leads since the last sync, in case a webhook was missed).

## 2. Webhook: subscribe the Meta App to the Page `leadgen` field

1. developers.facebook.com → your app → **Webhooks** (add the product if needed).
2. Choose the **Page** object → **Subscribe to this object**:
   - Callback URL: `https://wa.jscoretech.com/integrations/meta/webhook`
   - Verify token: the value of `META_WEBHOOK_VERIFY_TOKEN`
3. Under the Page object, subscribe to the field **`leadgen`**.
4. The app must be **Live** (in Development mode Meta only sends test leads from app admins).
5. Each client Page also has to subscribe the app. **Create Lead Ad** does this as its first step
   (`POST /{page_id}/subscribed_apps?subscribed_fields=leadgen`).

The admin page's **Webhook health** card shows the callback URL, which settings are missing, the last webhook received
and the received / synced / failed / ignored counts.

## 3. System User: assign the client Pages and Ad Accounts

1. Business Settings (business.facebook.com/settings) → **Users → System users** → add an **Admin** system user (or use the existing one).
2. **Assign assets** → **Pages**: tick each client Page (shared with your Business as a partner) → **Full control**
   (needed for lead forms, page tokens and `leads_retrieval`).
3. **Assign assets** → **Ad accounts**: tick each client ad account → **Manage ad account** (Full control).
4. **Generate new token** for your app with: `ads_management`, `ads_read`, `leads_retrieval`, `pages_manage_ads`,
   `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`, `business_management`. Set it as
   `META_SYSTEM_USER_TOKEN`. A System User token does not expire.
5. Client assets you only have **partner** access to must first be shared by the client with your Business
   (their Business Settings → Partners → your Business → share the Page and the ad account), then assigned as above.

## 4. Each client Page accepts the Lead Ads Terms

A Page can't run lead ads until someone with admin rights on it accepts Meta's Lead Ads Terms, once per Page:
`https://www.facebook.com/ads/leadgen/tos?page_id=<PAGE_ID>`.
Without it, creating the form or the ad fails with a "Terms of Service" error, which is shown in the client's row.
Accept the terms, then click **Resume**.

## 5. Leads Access Manager: don't block the app

In each client's Business Settings → **Integrations → Leads Access** (Leads Access Manager), for the client Page:
- either no restrictions are set (all apps and people with access may read leads),
- or your **CRM app** and your **System User** are listed as allowed.

If the app is blocked there, the webhook still arrives but reading the lead fails with a permission error (code 200 / 10).
The lead then shows under **Failed leads** on the admin page. Fix the access and click **Retry**.

## 6. Test with the Lead Ads Testing Tool

1. Open developers.facebook.com/tools/lead-ads-testing.
2. Choose the client **Page** and the **form** created by *Create Lead Ad* (it is named like the template's form name).
3. **Delete lead** (if an earlier test lead exists), then **Create lead**. The tool shows the webhook delivery status
   (it should say *success*, HTTP 200).
4. On `/wamaster/meta_leads`, *Webhook health* shows the event within seconds. The lead appears in the client's
   Leads CRM (`/crm`, source **Meta Lead Ad**), with the form, ad and campaign on the lead page.

If the tool says the delivery failed:
- **401**: the app secret is wrong or not set (step 1).
- **403** on subscribe: the verify token differs (step 2).
- A lead marked **ignored**: no active client in Meta Lead Ads uses that Page id.

## Using it

1. **Common template**: campaign and form name patterns (`{client}`, `{date}`), form questions, thank-you page,
   default target area, ages, budget, copy and button.
2. **Add client**: client account, ad account id, Page id, website and privacy policy URLs, creative image (Media
   Library link), any overrides, phone country, and the team member new leads are assigned to.

### Lead form questions

- **Prefilled field** (Full name, Email, Phone number, City, PIN code, Company…): Meta fills it from the person's
  profile. Each can be asked once.
- **Own question**: type the question. List answers (one per line) for multiple choice; leave them empty for a free-text
  answer. Keys are made from the text when saving and kept afterwards. At most 15 questions.
- The template's list is used by every client, unless the client's **Own lead form questions** switch is on (it starts
  as a copy of the template's list).
- Name, phone and email go into the lead's own fields; every other answer shows under the lead's answers in the CRM.
- Meta does not allow editing a published form: a change applies to forms created afterwards.

### Target area

- **Countries** (two-letter codes) target the whole country.
- **Local places** replace the countries when set (Meta refuses a country together with a place inside it):
  - *City, state or PIN code*: search by name in Meta's location list (choose the country in the small box first) and
    click **Add**. A city can take “+ km around” (17–80 km).
  - *Radius around a place*: a name, the radius (1–80 km) and the coordinates (in Google Maps right-click the spot and
    click the numbers to copy them) or a Google Maps link.
  - Places match people who live there or were there recently.
- A client's own area (its countries and / or places) replaces the template's whole area; leave both empty to use the
  template's.
3. **Create** (one) or tick several and **Create Lead Ad for selected**. The worker creates, in order: the Page
   subscription, the lead form, the campaign, the ad set, the creative and the ad. All are **PAUSED**, and each id is
   saved as soon as it is created. A failed step shows its Meta error; **Resume** continues from there.
   If Meta refuses Advantage+ audience with a custom age range, the ad set is retried once without it and a note says so.
4. Check the objects in Ads Manager (links in the row), then **Activate** (confirm dialog). The campaign, ad set and ad
   are set ACTIVE; Meta reviews the ad before it is shown.
