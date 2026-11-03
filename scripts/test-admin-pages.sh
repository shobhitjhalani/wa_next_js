#!/usr/bin/env bash
# End-to-end test of the /wamaster admin panel against the running dev server.
#   BASE_URL=http://localhost:3000 PG_URL=postgresql:///wa_jscoretech scripts/test-admin-pages.sh
# - every admin route returns 200 for a super admin (claude_admin / Test@123, must exist)
# - every route redirects to /wamaster when logged out
# - super-admin-only routes and actions are blocked for a normal admin (temporary claude_admin2)
# - the main write flows work (user add/status/recharge/delete, bulk message actions,
#   masters add/delete, team add/left, change password)
# Only rows named claude_* / fake numbers 9000000xxx are created, and they are removed at the end.
set -euo pipefail
export BASE_URL="${BASE_URL:-http://localhost:3000}"
export PG_URL="${PG_URL:-postgresql:///wa_jscoretech}"
command -v psql >/dev/null || export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"

[ -n "${LEGACY_PASSWORD_SALT:-}" ] || export LEGACY_PASSWORD_SALT="$(grep -E '^LEGACY_PASSWORD_SALT=' .env | cut -d= -f2- | tr -d '"')"
exec python3 -I - <<'PY'
import hashlib, base64, html, http.cookiejar, os, re, subprocess, sys, time, urllib.parse, urllib.request, uuid
from html.parser import HTMLParser

BASE = os.environ["BASE_URL"].rstrip("/")
PG = os.environ["PG_URL"]
failures = []

def sql(q):
    out = subprocess.run(["psql", PG, "-qtA", "-v", "ON_ERROR_STOP=1", "-c", q], capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr)
    return out.stdout.strip()

def legacy_hash(pw):
    salt = os.environ["LEGACY_PASSWORD_SALT"]
    s1 = lambda s: hashlib.sha1(s.encode()).hexdigest()
    return base64.b64encode(s1(salt + s1(salt + pw)).encode()).decode()

def check(cond, label):
    print(("PASS " if cond else "FAIL ") + label)
    if not cond:
        failures.append(label)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None

class Client:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar), NoRedirect)
    def req(self, path, data=None, headers=None):
        r = urllib.request.Request(BASE + path, data=data, headers=headers or {})
        try:
            res = self.op.open(r, timeout=120)
            return res.status, res.headers.get("location", ""), res.read().decode("utf8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, e.headers.get("location", ""), e.read().decode("utf8", "replace")
    def get(self, path):
        return self.req(path)
    def submit(self, path, pick, overrides=None, extra=None):
        """Load `path`, take the first <form> for which pick(fields) is true, post it with overrides."""
        _, _, body = self.get(path)
        forms = parse_forms(body)
        form = next((f for f in forms if pick(dict(f))), None)
        if form is None:
            raise RuntimeError(f"form not found on {path}")
        fields = [(k, v) for k, v in form if not (overrides and k in overrides)]
        for k, v in (overrides or {}).items():
            if v is not None:
                fields.append((k, v))
        fields += list((extra or []))
        boundary = uuid.uuid4().hex
        parts = []
        for k, v in fields:
            parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n')
        data = ("".join(parts) + f"--{boundary}--\r\n").encode()
        return self.req(path, data, {"content-type": f"multipart/form-data; boundary={boundary}"})
    def login(self, user, pw):
        return self.submit("/wamaster", lambda f: "txtusername" in f, {"txtusername": user, "txtpassword": pw})

class FormParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.forms = []; self.cur = None; self.select = None
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form":
            self.cur = []; self.forms.append(self.cur)
        elif self.cur is not None and tag == "input" and a.get("name"):
            t = a.get("type", "text")
            if t in ("checkbox", "radio") and "checked" not in a:
                return
            if t == "submit":
                return
            self.cur.append((a["name"], html.unescape(a.get("value", "") or "")))
        elif self.cur is not None and tag == "select" and a.get("name"):
            self.select = a["name"]; self.cur.append((a["name"], ""))
        elif self.cur is not None and tag == "option" and self.select and "selected" in a:
            self.cur[:] = [(k, v) for k, v in self.cur if k != self.select] + [(self.select, a.get("value", ""))]
    def handle_endtag(self, tag):
        if tag == "form": self.cur = None
        if tag == "select": self.select = None

def parse_forms(body):
    p = FormParser(); p.feed(body); return p.forms

# --------------------------------------------------------------------- routes
SUPER_ONLY = [
    "/wamaster/view/teams", "/wamaster/view/teams/add", "/wamaster/view/teams/view?id={emp}",
    "/wamaster/view/reports/wa_failed", "/wamaster/view/reports/wa_error", "/wamaster/view/reports/wa_system_error",
    "/wamaster/view/reports/wa_in_process", "/wamaster/view/reports/error", "/wamaster/view/reports/recharges",
    "/wamaster/view/reports/recharges_pending", "/wamaster/view/reports/summary", "/wamaster/view/reports/google_sheets",
    "/wamaster/view/reports/users", "/wamaster/view/reports/gs_users",
]
ALL_ADMINS = [
    "/wamaster/dashboard", "/wamaster/profile", "/wamaster/change_password",
    "/wamaster/view/user?ut=2", "/wamaster/view/user?ut=1", "/wamaster/view/user/add?ut=2",
    "/wamaster/view/reports/wa_send", "/wamaster/view/reports/wa_que", "/wamaster/view/reports/templates",
    "/wamaster/view/reports/wa_users",
]
WITH_DATA = [  # need an existing user / master row; super admin only checks
    "/wamaster/view/user/view?ut=2&id={wa}", "/wamaster/view/user/add?ut=2&id={wa}", "/wamaster/view/user/recharge?ut=2&id={wa}",
    "/wamaster/view/user/view?ut=1&id={corp}", "/wamaster/view/user/emails?ut=1&id={corp}",
    "/wamaster/view/masters?h=82", "/wamaster/view/masters/add?h=82", "/wamaster/view/masters?h=43",
    "/wamaster/view/reports/summary?s=1&wa_date=01-08-2025",
    "/wamaster/view/reports/wa_send?wa_date=01-08-2025&msg_type=1",
]

wa_user = sql("select u_id from js_user where u_type=2 and u_dstatus=0 order by u_id limit 1")
corp_user = sql("select u_id from js_user where u_type=1 and u_dstatus=0 order by u_id limit 1")
super_emp = sql("select emp_id from js_employee where emp_username='claude_admin'")
assert super_emp, "claude_admin (emp_m_type 4, password Test@123) must exist"
fmt = lambda p: p.format(wa=wa_user, corp=corp_user, emp=super_emp)
routes = [fmt(p) for p in SUPER_ONLY + ALL_ADMINS + WITH_DATA]

# Logged out: everything redirects to the login page.
anon = Client()
for p in routes:
    st, loc, _ = anon.get(p)
    check(st in (302, 303, 307) and loc.endswith("/wamaster"), f"logged out {p} -> login ({st} {loc})")

# Super admin: everything renders.
sa = Client()
st, loc, _ = sa.login("claude_admin", "Test@123")
check(st == 303, "super admin login")
for p in routes:
    t = time.time(); st, loc, body = sa.get(p)
    ok = st == 200 and "Application error" not in body and "NEXT_HTTP_ERROR" not in body
    check(ok, f"super admin {p} -> {st} ({time.time()-t:.1f}s)")

# Normal admin: super-only pages bounce to the dashboard; others render; sees only assigned users.
sql("delete from js_employee where emp_username='claude_admin2'")
emp2 = sql(f"insert into js_employee (emp_code,emp_name,emp_username,emp_password,emp_m_type,emp_status) values ('CLADM2','Claude Admin Two','claude_admin2','{legacy_hash('Test@123')}',1,1) returning emp_id").splitlines()[0]
na = Client()
st, _, _ = na.login("claude_admin2", "Test@123")
check(st == 303, "normal admin login")
for p in [fmt(x) for x in SUPER_ONLY]:
    st, loc, _ = na.get(p)
    check(st in (302, 303, 307) and loc.endswith("/wamaster/dashboard"), f"normal admin blocked {p} ({st} {loc})")
for p in [fmt(x) for x in ALL_ADMINS]:
    st, _, body = na.get(p)
    check(st == 200 and "Application error" not in body, f"normal admin {p} -> {st}")
st, _, body = na.get("/wamaster/view/user?ut=2")
check("No Record Found" in body, "normal admin sees no unassigned users")
st, loc, _ = na.get(fmt("/wamaster/view/user/view?ut=2&id={wa}"))
check(st in (302, 303, 307), "normal admin cannot open an unassigned user")
_, _, body = na.get("/wamaster/dashboard")
check("Data Masters" not in body and "Team Members" not in body, "normal admin menu hides super-admin items")

# --------------------------------------------------------------------- write flows (super admin)
sql("delete from js_user where u_username='claude_test_wa'")
st, loc, body = sa.submit("/wamaster/view/user/add?ut=2", lambda f: "data[name]" in f, {
    "data[name]": "Claude Test WA", "data[username]": "claude_test_wa", "data[parent_id]": corp_user,
    "data[status]": "1", "data[wa_phone_id]": "PHONE_TEST", "data[daily_limit]": "5", "txtpassword": "Secret#1",
})
new_id = sql("select u_id from js_user where u_username='claude_test_wa' and u_dstatus=0")
check(st == 303 and new_id and f"id={new_id}" in loc, f"add WA user -> {st} {loc}")
row = sql(f"select u_code, u_type, u_status, u_parent_id, u_daily_limit, left(u_password,4), length(u_access_code) from js_user where u_id={new_id}")
check(row.startswith(f"U{int(new_id):05d}|2|1|{corp_user}|5|$2b$|29"), f"new user row {row}")

st, loc, body = sa.submit("/wamaster/view/user/add?ut=2", lambda f: "data[name]" in f, {"data[username]": "claude_test_wa", "data[name]": "Dup", "data[parent_id]": corp_user})
check(st == 200 and "Username Already exists" in body, "duplicate username rejected")

st, loc, _ = sa.submit(f"/wamaster/view/user?ut=2&title=claude_test_wa", lambda f: f.get("id") == new_id and "status" in f)
check(sql(f"select u_status from js_user where u_id={new_id}") == "2", "status toggle -> Inactive")

before = sql(f"select u_valid_till from js_user where u_id={new_id}")
st, loc, body = sa.submit(f"/wamaster/view/user/recharge?ut=2&id={new_id}", lambda f: "user_id" in f, {"data[order_id]": "56070"})
rc = sql(f"select ur_plan_id, ur_recharge_type, ur_year, ur_created_by from js_user_recharge where ur_user_id={new_id}")
after = sql(f"select u_valid_till, u_wa_plan_status, u_active_plan from js_user where u_id={new_id}")
check(st == 303 and rc == f"56070|3|23-24|{super_emp}", f"recharge row {rc}")
check(int(after.split("|")[0]) > int(before) and after.endswith("|1|56070"), f"recharge extends validity {before} -> {after}")

# Bulk actions on fake messages of the test user.
t = int(time.time())
ids = sql(f"""insert into js_message (m_user_id,m_is_incoming,m_status,m_created_on,m_mobile_no,m_msg_type,m_content,m_message_id)
  values ({new_id},2,4,{t},'9000000001','text','claude bulk 1',''),({new_id},2,4,{t},'9000000002','text','claude bulk 2','') returning m_id""").split()
st, loc, _ = sa.submit(f"/wamaster/view/reports/wa_error?user_id={new_id}", lambda f: f.get("report") == "wa_error", {"cstatus": "2"}, [("mids[]", i) for i in ids])
check(sql(f"select string_agg(m_status::text, ',' order by m_id) from js_message where m_id in ({','.join(ids)})") == "1,1", "wa_error bulk Resend -> In Que")
st, loc, _ = sa.submit(f"/wamaster/view/reports/wa_que?user_id={new_id}", lambda f: f.get("report") == "wa_que", {"cstatus": "1"}, [("mids[]", ids[0])])
check(sql(f"select m_dstatus from js_message where m_id={ids[0]}") == "1", "wa_que bulk Delete -> hidden")

# A normal admin cannot run a super-only bulk action (posting the same form fields directly).
sql(f"update js_message set m_status=4, m_dstatus=0 where m_id={ids[1]}")
_, _, body = sa.get(f"/wamaster/view/reports/wa_error?user_id={new_id}")
form = next(f for f in parse_forms(body) if dict(f).get("report") == "wa_error")
boundary = uuid.uuid4().hex
fields = [(k, v) for k, v in form] + [("cstatus", "1"), ("mids[]", ids[1])]
data = ("".join(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n' for k, v in fields) + f"--{boundary}--\r\n").encode()
st, loc, _ = na.req(f"/wamaster/view/reports/wa_error", data, {"content-type": f"multipart/form-data; boundary={boundary}"})
check(sql(f"select m_dstatus from js_message where m_id={ids[1]}") == "0", f"normal admin bulk action on super-only report is refused ({st} {loc})")

# Masters
sql("delete from js_master_value where mv_type=101 and mv_name='claude_role'")
st, loc, _ = sa.submit("/wamaster/view/masters/add?h=101", lambda f: "mv_name" in f, {"mv_name": "claude_role", "mv_code": "cr"})
mv = sql("select mv_id from js_master_value where mv_type=101 and mv_name='claude_role' and mv_dstatus=0")
check(st == 303 and bool(mv), "masters add")
st, loc, _ = sa.submit("/wamaster/view/masters?h=101&title=claude_role", lambda f: f.get("id") == mv and "h" in f)
check(sql(f"select mv_dstatus from js_master_value where mv_id={mv}") == "1", "masters delete")

# Team member
sql("delete from js_employee where emp_username='claude_team1'")
st, loc, _ = sa.submit("/wamaster/view/teams/add", lambda f: "data[name]" in f, {
    "data[name]": "Claude Team One", "data[email_id]": "claude@example.test", "data[mobile]": "9000000003", "data[username]": "claude_team1", "txtpassword": "Team#123",
})
tm = sql("select emp_id from js_employee where emp_username='claude_team1'")
check(st == 303 and bool(tm), "team member add")
t1 = Client(); st, _, _ = t1.login("claude_team1", "Team#123")
check(st == 303, "new team member can log in (bcrypt)")
st, loc, _ = sa.submit("/wamaster/view/teams?title=claude_team1", lambda f: f.get("id") == tm and "txtdol" in f)
check(sql(f"select emp_is_left, emp_status from js_employee where emp_id={tm}") == "1|2", "team member marked left")
t2 = Client(); st, _, body = t2.login("claude_team1", "Team#123")
check(st == 200 and "Invalid Username or Password" in body, "left team member cannot log in")

# Change password (normal admin, then back)
st, _, body = na.submit("/wamaster/change_password", lambda f: "txtcpswrd" in f, {"txtcpswrd": "wrong", "txtnpswrd": "NewPass#1", "txtrpswrd": "NewPass#1"})
check("Invalid Password" in body, "change password rejects a wrong current password")
st, _, body = na.submit("/wamaster/change_password", lambda f: "txtcpswrd" in f, {"txtcpswrd": "Test@123", "txtnpswrd": "NewPass#1", "txtrpswrd": "NewPass#1"})
check("Password Successfully Changed" in body, "change password")
n2 = Client(); st, _, _ = n2.login("claude_admin2", "NewPass#1")
check(st == 303, "login with the new password")

# Delete user
st, loc, _ = sa.submit(f"/wamaster/view/user?ut=2&title=claude_test_wa", lambda f: f.get("id") == new_id and "status" not in f and "ut" in f)
check(sql(f"select u_dstatus from js_user where u_id={new_id}") == "1", "user soft delete")

# --------------------------------------------------------------------- cleanup
sql(f"delete from log.js_message_log where ml_user_id={new_id}")
sql(f"delete from js_message where m_user_id={new_id}")
sql(f"delete from js_user_recharge where ur_user_id={new_id}")
sql(f"delete from js_user where u_id={new_id}")
sql(f"delete from js_master_value where mv_id={mv}")
sql(f"delete from log.js_employee_login_log where ll_sid in ({emp2},{tm})")
sql(f"delete from js_employee where emp_id in ({emp2},{tm})")

print(f"\n{'ALL PASSED' if not failures else str(len(failures)) + ' FAILED'}")
sys.exit(1 if failures else 0)
PY
