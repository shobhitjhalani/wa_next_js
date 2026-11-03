#!/bin/bash
# End-to-end checks for the user panel against the running dev server.
# - every route: 200 + layout when signed in, redirect to / when signed out
# - key actions: resend, bulk status change, mark read, export, compose, chat,
#   AI pages, plan purchase with a simulated CCAvenue callback, embedded-signup save
# Uses its own local test user (claude_panel / Test@123) and fake numbers 9111111xxx.
# WhatsApp is never reached: local .env points WA_API_URL at a dead address, so sends
# end as "Cancelled" (status 4), which the checks expect.
#   BASE=http://localhost:3000 scripts/test-user-pages.sh
set -u
cd "$(dirname "$0")/.."
BASE=${BASE:-http://localhost:3000}
DB=${PGDATABASE:-wa_jscoretech}
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
TMP=$(mktemp -d)
JAR=$TMP/jar
PASS=0
FAIL=0
q() { psql -d "$DB" -tAq -c "$1"; }
ok() { PASS=$((PASS + 1)); echo "ok   $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL $1"; }
check() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }

# Hidden server-action fields of a page's form; $2 = substring of the action id to pick (optional).
action_fields() {
  local html=$1
  grep -oE '<input type="hidden" name="\$ACTION_[^"]*"( value="[^"]*")?' "$html" |
    sed -E 's/.*name="([^"]*)"( value="([^"]*)")?/\1 \3/' | sed 's/&quot;/"/g'
}
# post_action <page path> <field=value>...  (first server-action form on the page)
post_action() {
  local page=$1; shift
  curl -s -b "$JAR" "$BASE$page" -o "$TMP/form.html"
  local args=()
  local first_id=""
  while read -r name value; do
    [ -z "$name" ] && continue
    if [[ $name == \$ACTION_ID_* ]]; then
      [ -n "$first_id" ] && continue
      first_id=$name
    fi
    args+=(--form-string "$name=$value")
  done < <(action_fields "$TMP/form.html")
  for kv in "$@"; do args+=(--form-string "$kv"); done
  curl -s -b "$JAR" -c "$JAR" -o "$TMP/resp.html" -D "$TMP/resp.h" -w '%{http_code}' -H "Origin: $BASE" "${args[@]}" "$BASE$page"
}

# ---------------------------------------------------------------- fixtures
HASH=$(npx -s tsx --env-file=.env -e 'import {legacyHash} from "./src/lib/password"; process.stdout.write(legacyHash("Test@123"))')
q "DELETE FROM js_user WHERE u_username='claude_panel';"
UID_=$(q "INSERT INTO js_user (u_code,u_access_code,u_type,u_name,u_username,u_password,u_status,u_wa_plan_status,u_valid_till,u_parent_id,u_wa_phone_id,u_enable_ai,u_created_on)
  VALUES ('CLPANEL','CLPANEL',2,'Claude Panel','claude_panel','$HASH',1,1,2000000000,9999,'PHONEX',1,extract(epoch from now())::int) RETURNING u_id" | head -1)
T=$(date +%s)
ins() { q "INSERT INTO js_message (m_user_id,m_is_incoming,m_created_on,m_source,$1) VALUES ($UID_,$2,$T,2,$3) RETURNING m_id" | head -1; }
M_QUE=$(ins "m_status,m_mobile_no,m_msg_type,m_content" 2 "1,'9111111001','text','queued msg'")
M_SENT=$(ins "m_status,m_mobile_no,m_msg_type,m_msg_template_name,m_message_id,m_delivery_status" 2 "3,'9111111002','template','promo_tpl','wamid.A','read'")
M_FAIL=$(ins "m_status,m_mobile_no,m_msg_type,m_msg_template_name,m_message_id,m_delivery_status,m_status_response" 2 "3,'9111111003','template','promo_tpl','wamid.B','failed','Number not on WhatsApp'")
M_ERR=$(ins "m_status,m_mobile_no,m_msg_type,m_msg_template_name,m_message_id,m_status_response" 2 "3,'9111111004','template','promo_tpl','','[{\"error\":{\"message\":\"Token expired\"}}]'")
M_IN=$(ins "m_status,m_mobile_no,m_msg_type,m_content,m_is_read,m_sender_name" 1 "1,'9111111005','text','hello from customer',2,'Ravi'")
M_IMG=$(ins "m_status,m_mobile_no,m_msg_type,m_content,m_is_read,m_image" 1 "1,'9111111005','image','',2,'{\"id\":\"MEDIA1\",\"mime_type\":\"image/jpeg\"}'")
TPL=$(q "INSERT INTO js_user_templates (ut_user_id,ut_name,ut_template_type,ut_template_category,ut_header_type,ut_header,ut_message,ut_parameters,ut_buttons,ut_status,ut_created_on)
  VALUES ($UID_,'promo_tpl','template','MARKETING','IMAGE','https://cdn.test/h.jpg','Hi {{1}}, offer till {{2}}','{&#34;body_text&#34;:[[&#34;Ravi&#34;,&#34;Nov&#34;]]}','[{&#34;type&#34;:&#34;QUICK_REPLY&#34;,&#34;text&#34;:&#34;Yes&#34;}]',1,$T) RETURNING ut_id" | head -1)

cleanup() {
  q "DELETE FROM log.js_message_log WHERE ml_user_id=$UID_; DELETE FROM js_message WHERE m_user_id=$UID_;
     DELETE FROM js_user_templates WHERE ut_user_id=$UID_; DELETE FROM js_user_campaign WHERE uc_user_id=$UID_;
     DELETE FROM js_ai_knowledge_base WHERE kb_user_id=$UID_; DELETE FROM js_ai_prompt WHERE ai_user_id=$UID_;
     DELETE FROM js_ai_do_dont WHERE ai_user_id=$UID_; DELETE FROM js_user_recharge WHERE ur_user_id=$UID_;
     DELETE FROM log.js_payment_log WHERE p_user_id=$UID_; DELETE FROM log.js_user_login_log WHERE ll_sid=$UID_;
     DELETE FROM js_user WHERE u_id=$UID_;"
  rm -rf "$TMP"
}
trap cleanup EXIT

# ---------------------------------------------------------------- signed out
ROUTES="dashboard que reports reports_failed reports_error reports_templates incoming incoming_attachment templates templates_add compose create scheduler chat knowledge_base prompts do_dont wa_plans recharge success whatsapp"
for r in $ROUTES; do
  check "signed out /$r -> /" '[ "$(curl -s -o /dev/null -w "%{http_code} %{redirect_url}" "$BASE/$r")" = "307 $BASE/" ]'
done
check "signed out /chat_mobile_list -> /" '[[ "$(curl -s -o /dev/null -w "%{http_code}" "$BASE/chat_mobile_list")" =~ ^30 ]]'

# ---------------------------------------------------------------- sign in
curl -s -c "$JAR" "$BASE/" -o "$TMP/login.html"
args=(); while read -r n v; do args+=(--form-string "$n=$v"); done < <(action_fields "$TMP/login.html")
code=$(curl -s -b "$JAR" -c "$JAR" -o /dev/null -w '%{http_code}' "${args[@]}" --form-string txtusername=claude_panel --form-string txtpassword=Test@123 "$BASE/")
check "login" '[ "$code" = 303 ]'

for r in $ROUTES; do
  check "/$r 200 + layout" '[ "$(curl -s -b "$JAR" -o "$TMP/p.html" -w "%{http_code}" "$BASE/$r?s=false")" = 200 ] && grep -q "navbar-nav" "$TMP/p.html"'
done

# ---------------------------------------------------------------- lists
page() { curl -s -b "$JAR" "$BASE/$1" -o "$TMP/p.html"; }
page "que?s=false";              check "que shows queued"           'grep -q 9111111001 "$TMP/p.html" && ! grep -q 9111111002 "$TMP/p.html"'
page "reports?s=false";          check "reports shows sent"          'grep -q 9111111002 "$TMP/p.html"'
page "reports?del_status=read&wa_date="; check "reports del_status filter" 'grep -q 9111111002 "$TMP/p.html" && ! grep -q 9111111003 "$TMP/p.html"'
page "reports_failed?s=false";   check "failed shows failed + reason" 'grep -q 9111111003 "$TMP/p.html" && grep -q "Number not on WhatsApp" "$TMP/p.html"'
page "reports_error?s=false";    check "error shows API error text"  'grep -q 9111111004 "$TMP/p.html" && grep -q "Token expired" "$TMP/p.html"'
page "reports_templates?s=false"; check "templates report counts"    'grep -q promo_tpl "$TMP/p.html"'
page "incoming?s=false";         check "incoming shows unread"       'grep -q "hello from customer" "$TMP/p.html"'
page "incoming_attachment?s=false"; check "attachments only media"   'grep -q "view_attachment?id=$M_IMG" "$TMP/p.html" && ! grep -q "hello from customer" "$TMP/p.html"'
page "templates?s=false";        check "templates list (Meta down -> warning, list kept)" 'grep -q promo_tpl "$TMP/p.html" && grep -q "Could not refresh templates" "$TMP/p.html"'

# ---------------------------------------------------------------- actions
code=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code} %{redirect_url}' -H "Origin: https://evil.example" -d "id=$M_QUE&p=q" "$BASE/send_wa")
check "send_wa blocks cross-site POST" '[[ "$code" == 403* ]]'
code=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' -H "Origin: $BASE" -d "id=$M_QUE&p=q" "$BASE/send_wa")
check "send_wa resend -> 303, message processed (Cancelled: API is dead)" '[ "$code" = 303 ] && [ "$(q "select m_status from js_message where m_id=$M_QUE")" = 4 ]'

code=$(post_action "/reports_failed?s=false" cstatus=2 "mids=$M_FAIL")
check "failed: Resend re-queues (status 1, cleared delivery)" '[ "$(q "select m_status||coalesce(m_delivery_status,'"'"''"'"') from js_message where m_id=$M_FAIL")" = 1 ]'
code=$(post_action "/reports_error?s=false" cstatus=1 "mids=$M_ERR")
check "error: Delete hides message" '[ "$(q "select m_dstatus from js_message where m_id=$M_ERR")" = 1 ]'
code=$(post_action "/incoming?s=false" cstatus=1 "mids=$M_IN")
check "incoming: mark read" '[ "$(q "select m_is_read from js_message where m_id=$M_IN")" = 1 ]'

curl -s -b "$JAR" -D "$TMP/x.h" -o "$TMP/x.xlsx" "$BASE/export_messages?type=1&wa_date="
check "export xlsx" 'grep -qi "spreadsheetml" "$TMP/x.h" && [ "$(head -c 2 "$TMP/x.xlsx")" = PK ]'

curl -s -b "$JAR" "$BASE/templates_content?id=$TPL" -o "$TMP/t.json"
check "templates_content JSON (2 params, image header, button)" 'grep -q "\"paramCount\":2" "$TMP/t.json" && grep -q "\"headerType\":\"IMAGE\"" "$TMP/t.json" && grep -q "\"text\":\"Yes\"" "$TMP/t.json"'
check "templates_content other user -> 404" '[ "$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/templates_content?id=1")" = 404 ]'

UCODE="cu_test_$T"
code=$(post_action "/compose?tm=$TPL&s=false" "temp_id=$TPL" "body_parameters=Ravi" "body_parameters=15 Nov" "txt_contact=9111111101, 9111111102,9111111101" "ucode=$UCODE")
check "compose queues 2 unique numbers" 'grep -q "2 Messages Successfully Added" "$TMP/resp.html" && [ "$(q "select count(*) from js_message where m_user_id=$UID_ and m_status=1 and m_msg_template_para='"'"'Ravi,15 Nov'"'"' and m_msg_lite=2 and m_campaign_id>0")" = 2 ]'
code=$(post_action "/compose?tm=$TPL&s=false" "temp_id=$TPL" "body_parameters=Ravi" "body_parameters=15 Nov" "txt_contact=9111111103" "ucode=$UCODE")
check "compose same ucode -> Duplicate Campaign" 'grep -q "Duplicate Campaign" "$TMP/resp.html"'

curl -s -b "$JAR" "$BASE/chat_mobile_list" -o "$TMP/c.json"
check "chat list has contact with unread count" 'grep -q "9111111005" "$TMP/c.json"'
curl -s -b "$JAR" "$BASE/chat_message?mb=9111111005" -o "$TMP/m.json"
check "chat conversation + marks read" 'grep -q "hello from customer" "$TMP/m.json" && [ "$(q "select count(*) from js_message where m_user_id=$UID_ and m_mobile_no='"'"'9111111005'"'"' and m_is_read=2")" = 0 ]'
code=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' -H "Origin: $BASE" -H 'content-type: application/json' -d '{"mb":"9111111005","msg":"Thanks Ravi"}' "$BASE/save_msg")
check "save_msg stores + sends reply" '[ "$code" = 200 ] && [ "$(q "select m_status from js_message where m_user_id=$UID_ and m_content='"'"'Thanks Ravi'"'"'")" = 4 ]'

code=$(curl -s -b "$JAR" -o "$TMP/v.txt" -w '%{http_code}' "$BASE/view_attachment?id=$M_IMG")
check "view_attachment: Meta down -> clear 502" '[ "$code" = 502 ] && grep -q "WhatsApp did not return" "$TMP/v.txt"'
check "view_attachment other user's message -> not found" '[ "$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/view_attachment?id=1")" = 404 ]'

post_action "/knowledge_base?s=false&type=add" "title=Opening hours" "keywords=hours,time" "content=We open at 9 'am'" >/dev/null
check "knowledge base saved (entities like PHP)" '[ "$(q "select kb_content from js_ai_knowledge_base where kb_user_id=$UID_")" = "We open at 9 &#39;am&#39;" ]'
post_action "/prompts?s=false" "title=Greeting" "keywords=hi" "content=Be polite" >/dev/null
check "prompt saved" '[ "$(q "select count(*) from js_ai_prompt where ai_user_id=$UID_")" = 1 ]'
post_action "/do_dont?s=false" "dos=Be brief" "dos=" "dont=Share prices" >/dev/null
check "do/dont saved (empty lines skipped)" '[ "$(q "select string_agg(ai_dd_type||ai_content, '"'"'|'"'"' order by ai_dd_id) from js_ai_do_dont where ai_user_id=$UID_")" = "1Be brief|2Share prices" ]'

# Plan purchase: wa_plans -> paycca (form for CCAvenue, not submitted) -> simulated callback.
post_action "/wa_plans?s=false" "dvalue=56041" >/dev/null
LOC=$(grep -i '^x-action-redirect:\|^location:' "$TMP/resp.h" | head -1 | tr -d '\r' | awk '{print $2}')
PL=$(q "select p_id from log.js_payment_log where p_user_id=$UID_ order by p_id desc limit 1")
check "wa_plans creates pending payment log (5000 + 18% GST)" '[ -n "$PL" ] && [ "$(q "select p_amount::text||p_status::text||p_order_no from log.js_payment_log where p_id=$PL")" = "5900156041" ] && [[ "$LOC" == /paycca?pl=$PL* ]]'
curl -s -b "$JAR" "$BASE/paycca?pl=$PL" -o "$TMP/cca.html"
check "paycca renders CCAvenue form" 'grep -q "secure.ccavenue.com" "$TMP/cca.html" && grep -q "encRequest" "$TMP/cca.html"'
PNO=$(q "select p_no from log.js_payment_log where p_id=$PL")
ENC=$(node -e '
const c=require("crypto");const key=c.createHash("md5").update(process.env.CCA_WORKING_KEY||"").digest();
const iv=Buffer.from([...Array(16).keys()]);const e=c.createCipheriv("aes-128-cbc",key,iv);
process.stdout.write(Buffer.concat([e.update(process.argv[1]),e.final()]).toString("hex"));' "order_id=$PNO&tracking_id=TRK1&bank_ref_no=BANK1&order_status=Success&failure_message=&payment_mode=UPI&amount=5900.00")
BEFORE=$(q "select u_valid_till from js_user where u_id=$UID_")
code=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' --data-urlencode "encResp=$ENC" "$BASE/payment/ccavenue")
check "CCAvenue success callback -> /success, plan +30 days, recharge row" '[[ "$code" == 303* ]] && [ "$(q "select p_status from log.js_payment_log where p_id=$PL")" = 2 ] && [ "$(q "select u_valid_till - $BEFORE from js_user where u_id=$UID_")" = 2592000 ] && [ "$(q "select count(*) from js_user_recharge where ur_user_id=$UID_ and ur_plan_id=56041")" = 1 ]'
curl -s -o /dev/null --data-urlencode "encResp=$ENC" "$BASE/payment/ccavenue"
check "replayed callback does not credit twice" '[ "$(q "select count(*) from js_user_recharge where ur_user_id=$UID_")" = 1 ]'
page "success?pl=$PL"; check "success page shows validity" 'grep -q "Your Account is now valid till" "$TMP/p.html"'
page "recharge";       check "recharge history lists it" 'grep -q "1 Month Unlimited" "$TMP/p.html"'

code=$(curl -s -b "$JAR" -o /dev/null -w '%{http_code}' -H "Origin: $BASE" -H 'content-type: application/json' -d '{"phone_number_id":"PH9","waba_id":"WB9","business_id":"BZ9"}' "$BASE/user_update")
check "user_update saves embedded-signup ids" '[ "$code" = 200 ] && [ "$(q "select u_wa_phone_id||u_wa_b_id||u_business_id from js_user where u_id=$UID_")" = PH9WB9BZ9 ]'

curl -s -b "$JAR" -c "$JAR" -o /dev/null "$BASE/logout"
check "after logout /dashboard -> /" '[ "$(curl -s -b "$JAR" -o /dev/null -w "%{http_code}" "$BASE/dashboard")" = 307 ]'

echo
echo "passed: $PASS  failed: $FAIL"
[ "$FAIL" = 0 ]
