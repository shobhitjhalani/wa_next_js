// Daily report e-mails. Ports of cron/email.php -> Email::fun_wa_report() with
// email_template/wa_report.php, and cron/user_email.php -> fun_wa_user_template_report()
// with email_template/wa_templates.php.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { config, istParts } from "@/lib/config";
import { sendMail } from "@/lib/mailer";
import {
  REPORT_ADMIN_EMAIL,
  TEMPLATE_REPORT_BCC,
  TEMPLATE_REPORT_CC,
  TEMPLATE_REPORT_USERS,
} from "@/lib/wa/client-rules";

type Counts = Record<string, number>;
type Agg = { k1: string; k2: string; s: string; n: bigint };

const TYPES = ["template", "flow", "catalogue"];

// ------------------------------------------------------------------ formatting

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const num = (n: number | undefined) => (n ? Math.round(n).toLocaleString("en-US") : "0");
const ucfirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function istFormat(d: Date, opts: Intl.DateTimeFormatOptions) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: config.timezone, hourCycle: "h23", ...opts }).formatToParts(d).map((p) => [p.type, p.value]),
  );
}
/** PHP date('M d,Y') */
const mdY = (d = new Date()) => {
  const p = istFormat(d, { month: "short", day: "2-digit", year: "numeric" });
  return `${p.month} ${p.day},${p.year}`;
};
/** PHP date('d-m-Y H:i:s', t) */
const dmYHis = (t: number) => {
  const p = istFormat(new Date(t * 1000), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute}:${p.second}`;
};
const hm = () => {
  const p = istFormat(new Date(), { hour: "2-digit", minute: "2-digit" });
  return `${p.hour}:${p.minute}`;
};

const TABLE = `<table class="table table-bordered" style="border: solid 1px #000;" border="1" cellpadding="5" cellspacing="0">`;
const cellR = (v: string, tag = "td") => `<${tag} style="text-align:right;">${v}</${tag}>`;

function wrap(title: string, sections: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title></head>
<body style="background-color:#f6f6f6;font-family:sans-serif;font-size:14px;line-height:1.4;margin:0;padding:0;">
<table role="presentation" width="100%" style="background-color:#f6f6f6;"><tr><td></td>
<td style="max-width:720px;width:720px;margin:0 auto;padding:10px;display:block;">
<div style="background:#ffffff;border-radius:3px;padding:20px;">${sections}</div>
<div style="text-align:center;color:#999999;font-size:12px;padding:10px;">Powered by JS Coretech Pvt. Ltd.</div>
</td><td></td></tr></table></body></html>`;
}

/** PHP ksort() on status names, then the fixed extra columns. */
const headings = (statuses: Iterable<string>, extra: string[]) => [...new Set([...[...statuses].sort(), ...extra])];

// ------------------------------------------------------------------ wa_report.php

async function waReportHtml(): Promise<string> {
  const start = istParts().startOfDay;
  const q = <T>(sql: Prisma.Sql) => db.$queryRaw<T[]>(sql);

  const sent = await q<Agg>(Prisma.sql`
    SELECT m_user_id::text k1, '' k2, coalesce(m_delivery_status,'') s, count(*) n FROM js_message
     WHERE m_is_incoming = 2 AND m_status = 3 AND m_message_id <> '' AND m_dstatus = 0 AND m_in_process_on >= ${start}
     GROUP BY 1, 3 ORDER BY 1`);
  const perUser = (where: Prisma.Sql) =>
    q<Agg>(Prisma.sql`SELECT m_user_id::text k1, '' k2, '' s, count(*) n FROM js_message WHERE m_dstatus = 0 AND ${where} GROUP BY 1 ORDER BY 1`);
  const que = await perUser(Prisma.sql`m_is_incoming = 2 AND m_status = 1`);
  const inProcess = await perUser(Prisma.sql`m_is_incoming = 2 AND m_status = 6`);
  const incoming = await perUser(Prisma.sql`m_is_incoming = 1 AND m_created_date = ${start}`);
  const errors = await perUser(Prisma.sql`m_is_incoming = 2 AND m_status = 3 AND m_message_id = '' AND m_in_process_on >= ${start}`);
  const tillDate = await q<Agg>(Prisma.sql`
    SELECT m_user_id::text k1, '' k2, '' s, count(*) n FROM js_message
     WHERE m_msg_type IN (${Prisma.join(TYPES)}) AND m_delivery_status <> 'failed' AND m_is_incoming = 2
       AND m_status = 3 AND m_message_id <> '' AND m_dstatus = 0
     GROUP BY 1`);

  let summary = "";
  if (sent.length || que.length || incoming.length || errors.length) {
    const data = new Map<string, Counts>();
    const add = (u: string, col: string, n: bigint) => {
      const row = data.get(u) ?? {};
      row[col] = (row[col] ?? 0) + Number(n);
      data.set(u, row);
    };
    for (const r of sent) add(r.k1, r.s || "sent", r.n);
    for (const [rows, col] of [[que, "Que"], [inProcess, "In Process"], [incoming, "Incoming"], [errors, "Error"]] as const) {
      for (const r of rows) add(r.k1, col, r.n);
    }
    const cols = headings(new Set(sent.map((r) => r.s || "sent")), ["Incoming", "Error", "Que", "In Process"]);
    const notCounted = new Set(["Que", "Incoming", "failed", "Error", "In Process"]);
    const till = new Map(tillDate.map((r) => [r.k1, Number(r.n)]));
    const users = new Map(
      (await db.js_user.findMany({ where: { u_id: { in: [...data.keys()].map(Number) } }, select: { u_id: true, u_username: true, u_last_wa_send: true } }))
        .map((u) => [String(u.u_id), u]),
    );

    const totals: Counts = {};
    let grandSend = 0;
    let body = "";
    let sn = 0;
    for (const [u, row] of data) {
      let rowSend = 0;
      const user = users.get(u);
      body += `<tr><td>${++sn}</td><td>${esc(user?.u_username)}</td><td>${user?.u_last_wa_send ? dmYHis(user.u_last_wa_send) : ""}</td>`;
      for (const c of cols) {
        const v = row[c];
        if (v !== undefined) {
          if (!notCounted.has(c)) rowSend += v;
          totals[c] = (totals[c] ?? 0) + v;
        }
        body += cellR(v !== undefined ? num(v) : "0");
      }
      grandSend += rowSend;
      body += cellR(num(rowSend), "th") + `<th>${num(till.get(u))}</th></tr>`;
    }
    summary = `${TABLE}<thead><tr><th>S. No.</th><th>UserName</th><th>Last WA Send</th>${cols.map((c) => `<th>${esc(ucfirst(c))}</th>`).join("")}<th>Total Send</th><th>WA Send Till Date</th></tr></thead>
<tbody>${body}</tbody><tfoot><tr><th colspan="3">Total</th>${cols.map((c) => cellR(totals[c] !== undefined ? num(totals[c]) : "", "th")).join("")}${cellR(num(grandSend), "th")}<th></th></tr></tfoot></table>`;
  }

  // User template report (all users, today)
  const end = start + 86_400;
  const tplAgg = (where: Prisma.Sql) =>
    q<Agg>(Prisma.sql`
      SELECT m_user_id::text k1, coalesce(m_msg_template_name,'') k2, coalesce(m_delivery_status,'') s, count(*) n FROM js_message
       WHERE m_is_incoming = 2 AND m_msg_type IN (${Prisma.join(TYPES)}) AND m_dstatus = 0 AND ${where}
       GROUP BY 1, 2, 3 ORDER BY 1 DESC`);
  const tSent = await tplAgg(Prisma.sql`m_message_id <> '' AND m_status = 3 AND m_in_process_on >= ${start} AND m_in_process_on <= ${end}`);
  const tQue = await tplAgg(Prisma.sql`m_status = 1`);
  const tProc = await tplAgg(Prisma.sql`m_status = 6`);
  const tErr = await tplAgg(Prisma.sql`m_message_id = '' AND m_status = 4 AND m_in_process_on >= ${start} AND m_in_process_on <= ${end}`);

  const tData = new Map<string, Map<string, Counts>>();
  const addT = (u: string, t: string, col: string, n: bigint) => {
    const byTpl = tData.get(u) ?? new Map<string, Counts>();
    const row = byTpl.get(t) ?? {};
    row[col] = (row[col] ?? 0) + Number(n);
    byTpl.set(t, row);
    tData.set(u, byTpl);
  };
  for (const r of tSent) addT(r.k1, r.k2, r.s || "Not Delivered", r.n);
  for (const [rows, col] of [[tQue, "Que"], [tProc, "In Process"], [tErr, "Error"]] as const) for (const r of rows) addT(r.k1, r.k2, col, r.n);
  const tCols = headings(new Set(tSent.map((r) => r.s || "Not Delivered")), ["Error", "Not Delivered", "Que", "In Process"]);
  const tNotCounted = new Set(["Que", "Incoming", "failed", "Error", "In Process"]);
  const names = new Map(
    (await db.js_user.findMany({ where: { u_id: { in: [...tData.keys()].map(Number) } }, select: { u_id: true, u_name: true } })).map((u) => [String(u.u_id), u.u_name]),
  );

  const grand: Counts = {};
  let grandSend = 0;
  let tBody = "";
  let sn = 0;
  const totalRow = (label: string, t: Counts, send: number) =>
    `<tr><th colspan="3">${label}</th>${tCols.map((c) => cellR(t[c] !== undefined ? num(t[c]) : "", "th")).join("")}${cellR(num(send), "th")}</tr>`;
  for (const [u, byTpl] of tData) {
    const sub: Counts = {};
    let subSend = 0;
    for (const [tpl, row] of byTpl) {
      let rowSend = 0;
      tBody += `<tr><td>${++sn}</td><td>${esc(names.get(u))}</td><td>${esc(tpl)}</td>`;
      for (const c of tCols) {
        const v = row[c] ?? 0;
        if (row[c] !== undefined) {
          if (!tNotCounted.has(c)) rowSend += v;
          sub[c] = (sub[c] ?? 0) + v;
          grand[c] = (grand[c] ?? 0) + v;
        }
        tBody += cellR(num(v));
      }
      subSend += rowSend;
      tBody += cellR(num(rowSend), "th") + "</tr>";
    }
    grandSend += subSend;
    tBody += totalRow("Total", sub, subSend);
  }
  const templates = `${TABLE}<thead><tr><th>S. No.</th><th>User</th><th>Template Name</th>${tCols.map((c) => cellR(esc(ucfirst(c)), "th")).join("")}${cellR("Total", "th")}</tr></thead>
<tbody>${tBody}</tbody><tfoot>${totalRow("Grand Total", grand, grandSend)}</tfoot></table>`;

  return wrap("WA Report", `<h3>WhatsApp Summary as on ${mdY()}</h3>${summary}<h3>User Template Report</h3>${templates}`);
}

export async function sendWaReport(log: (l: string) => void) {
  const res = await sendMail({
    to: { email: REPORT_ADMIN_EMAIL, name: "JS CoreTech" },
    subject: `WA Business API Report ${mdY()} ${hm()}`,
    html: await waReportHtml(),
  });
  log(`WA report e-mailed to ${REPORT_ADMIN_EMAIL}${res.dryRun ? " (dry run, not sent)" : ""}`);
  return res;
}

// ------------------------------------------------------------------ wa_templates.php

async function templateTable(userId: number, since: number | null, until: number | null, emptyLabel: string) {
  const range = Prisma.sql`${since !== null ? Prisma.sql` AND m_created_on >= ${since}` : Prisma.empty}${until !== null ? Prisma.sql` AND m_created_on <= ${until}` : Prisma.empty}`;
  const agg = (where: Prisma.Sql) =>
    db.$queryRaw<Agg[]>(Prisma.sql`
      SELECT coalesce(m_msg_template_name,'') k1, '' k2, coalesce(m_delivery_status,'') s, count(*) n FROM js_message
       WHERE m_is_incoming = 2 AND m_msg_type = 'template' AND m_user_id = ${userId} AND m_dstatus = 0 AND ${where}
       GROUP BY 1, 3`);
  const sentRows = await agg(Prisma.sql`m_message_id <> '' AND m_status = 3 ${range}`);
  const queRows = await agg(Prisma.sql`m_status IN (1, 6)`);
  // NOTE: PHP halved "tata_farmers" errors above 5000 in this table; real numbers are reported.
  const errRows = await agg(Prisma.sql`m_message_id = '' AND m_status = 3 ${range}`);

  const data = new Map<string, Counts>();
  const add = (t: string, col: string, n: bigint) => {
    const row = data.get(t) ?? {};
    row[col] = (row[col] ?? 0) + Number(n);
    data.set(t, row);
  };
  const norm = (s: string) => (["", "sent", "delivered", "read"].includes(s) ? "send" : s);
  for (const r of sentRows) add(r.k1, norm(r.s), r.n);
  for (const r of errRows) add(r.k1, "Error", r.n);
  for (const r of queRows) add(r.k1, "Que", r.n);
  const cols = headings(new Set(sentRows.map((r) => norm(r.s))), ["Error", "Que"]);
  const notCounted = new Set(["Que", "Incoming", "failed", "Error"]);

  const totals: Counts = {};
  let grandSend = 0;
  let body = "";
  let sn = 0;
  for (const [tpl, row] of data) {
    let rowSend = 0;
    body += `<tr><td>${++sn}</td><td>${esc(tpl)}</td>`;
    for (const c of cols) {
      const v = row[c] ?? 0;
      if (row[c] !== undefined) {
        if (!notCounted.has(c)) rowSend += v;
        totals[c] = (totals[c] ?? 0) + v;
      }
      body += cellR(num(v));
    }
    grandSend += rowSend;
    body += cellR(num(rowSend), "th") + "</tr>";
  }
  const label = (c: string) => esc(c === "" ? emptyLabel : ucfirst(c));
  return `${TABLE}<thead><tr><th>S. No.</th><th>Template Name</th>${cols.map((c) => cellR(label(c), "th")).join("")}${cellR("Total", "th")}</tr></thead>
<tbody>${body}</tbody><tfoot><tr><th colspan="2">Total</th>${cols.map((c) => cellR(totals[c] !== undefined ? num(totals[c]) : "", "th")).join("")}${cellR(num(grandSend), "th")}</tr></tfoot></table>`;
}

async function templateReportHtml(userId: number) {
  const start = istParts().startOfDay;
  const today = await templateTable(userId, start, start + 86_400, "Sent");
  let title = "WhatsApp Summary Till Date";
  let since: number | null = null;
  if (userId === 11) {
    // Month to date for user 11.
    const p = istFormat(new Date(), { month: "2-digit", year: "numeric" });
    const name = istFormat(new Date(), { month: "short" }).month;
    title = `WhatsApp Summary of ${name} ,${p.year}`;
    since = Date.UTC(Number(p.year), Number(p.month) - 1, 1) / 1000 - 5.5 * 3600; // 1st 00:00 IST
  }
  const overall = await templateTable(userId, since, null, "Not Delivered");
  return wrap("WA Templates Report", `<hr/><h3>WhatsApp Summary on ${mdY()}</h3>${today}<hr/><h3>${esc(title)}</h3>${overall}`);
}

export async function sendTemplateReports(log: (l: string) => void) {
  let sent = 0;
  for (const userId of TEMPLATE_REPORT_USERS) {
    const user = await db.js_user.findUnique({ where: { u_id: userId }, select: { u_name: true, u_email_id: true } });
    if (!user?.u_email_id) {
      log(`template report: user ${userId} has no e-mail, skipped`);
      continue;
    }
    const res = await sendMail({
      to: { email: user.u_email_id, name: user.u_name ?? "" },
      cc: TEMPLATE_REPORT_CC[userId],
      bcc: TEMPLATE_REPORT_BCC,
      subject: `WA Messages Report of ${user.u_name ?? ""} as on ${mdY()}`,
      html: await templateReportHtml(userId),
    });
    log(`template report for user ${userId} e-mailed${res.dryRun ? " (dry run, not sent)" : ""}`);
    sent++;
  }
  return sent;
}

export { waReportHtml, templateReportHtml };
