// Integration test for the inbound webhooks, the webhook status queue, report e-mails
// and media cleanup. Nothing external is called: Meta and every client URL point at a
// local mock server, and e-mail runs in dry-run mode.
// Uses the local test user `claude_test` and fake numbers 9000000xxx; cleans up after.
//   npx tsx scripts/test-webhooks.ts            (dev server on :3000 optional, for route checks)
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";

type Captured = { path: string; body: any };
const calls: Captured[] = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    calls.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : null });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ messages: [{ id: `wamid.OUT${calls.length}` }] }));
  });
});

const PHONE_ID = "TESTPHONE_WEBHOOK";

function waPayload(value: Record<string, unknown>, field = "messages") {
  return { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field, value: { messaging_product: "whatsapp", metadata: { phone_number_id: PHONE_ID }, ...value } }] }] };
}
const incoming = (id: string, message: Record<string, unknown>, name = "Ravi Test") =>
  waPayload({ contacts: [{ profile: { name }, wa_id: "919000000001" }], messages: [{ from: "919000000001", id, timestamp: "1", ...message }] });

async function main() {
  await new Promise<void>((r) => server.listen(0, r));
  const mock = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const tmp = mkdtempSync(path.join(tmpdir(), "wa-webhook-test-"));
  process.env.WA_API_URL = `${mock}/`;
  process.env.MEDIA_ROOT = path.join(tmp, "media");
  process.env.MAIL_DRY_RUN = "1";

  const { db } = await import("../src/lib/db");
  const { processWebhook } = await import("../src/lib/wa/inbound");
  const { applyWebhookQueue } = await import("../src/worker/jobs/webhook-que");
  const { deleteOldMediaFolders } = await import("../src/worker/jobs/maintenance");
  const { waReportHtml, templateReportHtml } = await import("../src/worker/jobs/reports");
  const { sendMail } = await import("../src/lib/mailer");

  const user = await db.js_user.findFirstOrThrow({ where: { u_username: "claude_test" } });
  const uid = user.u_id;
  const setUser = (data: Record<string, unknown>) => db.js_user.update({ where: { u_id: uid }, data });
  await setUser({
    u_parent_id: 9999, u_wa_phone_id: PHONE_ID, u_type: 2, u_status: 1, u_dstatus: 0, u_wa_plan_status: 1,
    u_send_app: 2, u_wa_app_url: `${mock}/app`, u_wa_incoming_url: `${mock}/incoming`,
    u_wa_catalogue_url: `${mock}/cart`, u_wa_form_url: `${mock}/form`, u_wa_no: "9999999999",
  });
  const cleanup = async () => {
    const ids = (await db.js_message.findMany({ where: { m_user_id: uid }, select: { m_id: true } })).map((m) => m.m_id);
    await db.log_js_message_log.deleteMany({ where: { ml_m_id: { in: ids } } });
    await db.js_message.deleteMany({ where: { m_user_id: uid } });
    await db.js_user_block_list.deleteMany({ where: { ubl_user_id: uid } });
    await db.js_user_contact_list.deleteMany({ where: { cl_user_id: uid } });
    await db.js_incoming_log.deleteMany({ where: { il_user_id: uid } });
    await db.log_js_webhook_que.deleteMany({ where: { msg_id: { startsWith: "wamid.TESTQ" } } });
    await db.log_js_api_data_log.deleteMany({ where: { adl_url: "calls", adl_value: { contains: PHONE_ID } } });
  };
  await cleanup();
  const bodies = (p: string) => calls.filter((c) => c.path === p).map((c) => c.body);
  const incomingRows = () => db.js_message.findMany({ where: { m_user_id: uid, m_is_incoming: 1 }, orderBy: { m_id: "asc" } });

  // 1. unknown phone number id
  assert.deepEqual(
    await processWebhook({ entry: [{ changes: [{ value: { metadata: { phone_number_id: "nope" } } }] }] }, {}, "webhook"),
    { status: "0", msg: "Parameter Missing", data: [] },
  );

  // 2. incoming text: stored (entities like PHP), contact created, forwarded to the incoming URL
  const r = await processWebhook(incoming("wamid.IN1", { type: "text", text: { body: `Hi "there" it's me 😊` } }), { a: "1" }, "webhook");
  assert.deepEqual(r, { status: "200", msg: "1", data: { post: {}, request: { a: "1" } } });
  let rows = await incomingRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].m_content, "Hi &#34;there&#34; it&#39;s me 😊");
  assert.equal(rows[0].m_mobile_no, "9000000001");
  assert.equal(rows[0].m_image, `{&#34;body&#34;:&#34;Hi \\&#34;there\\&#34; it&#39;s me 😊&#34;}`);
  const contact = await db.js_user_contact_list.findFirstOrThrow({ where: { cl_user_id: uid } });
  assert.equal(contact.cl_name, "Ravi Test");
  assert.equal(rows[0].m_contact_id, contact.cl_id);
  assert.deepEqual(bodies("/incoming")[0], {
    sender_name: "Ravi Test", sender_no: "9000000001", message: `Hi "there" it's me 😊`, message_id: "wamid.IN1", receiver_mobile_no: "9999999999",
  });

  // 3. Meta retry of the same message is ignored
  await processWebhook(incoming("wamid.IN1", { type: "text", text: { body: "again" } }), {}, "webhook");
  assert.equal((await incomingRows()).length, 1);

  // 4. STOP opts the sender out; image -> File_Attachment; reply context saved
  await processWebhook(incoming("wamid.IN2", { type: "text", text: { body: "STOP" } }), {}, "webhook");
  assert.equal(await db.js_user_block_list.count({ where: { ubl_user_id: uid, ubl_mobile_no: "9000000001" } }), 1);
  await processWebhook(incoming("wamid.IN3", { type: "image", image: { id: "MEDIA1", mime_type: "image/jpeg" }, context: { id: "wamid.OUTX" } }), {}, "webhook");
  rows = await incomingRows();
  assert.equal(rows.at(-1)!.m_content, "File_Attachment");
  assert.equal(rows.at(-1)!.m_reply_message_id, "wamid.OUTX");

  // 5. button reply and call permission (PHP never matched this one)
  await processWebhook(incoming("wamid.IN4", { type: "interactive", interactive: { type: "button_reply", button_reply: { id: "btn1", title: "Yes" } } }), {}, "webhook");
  await processWebhook(incoming("wamid.IN5", { type: "interactive", interactive: { type: "call_permission_reply", call_permission_reply: { response: "accept" } } }), {}, "webhook");
  rows = await incomingRows();
  assert.deepEqual(rows.slice(-2).map((m) => m.m_content), ["Yes", "Call Permission Granted"]);

  // 6. catalogue order: one forward per item + incoming log
  await processWebhook(
    incoming("wamid.IN6", {
      type: "order",
      order: { catalog_id: "C1", product_items: [
        { product_retailer_id: "SKU1", quantity: 2, item_price: 100, currency: "INR" },
        { product_retailer_id: "SKU2", quantity: 1, item_price: 50, currency: "INR" },
      ] },
    }),
    {}, "webhook",
  );
  assert.deepEqual(bodies("/cart").map((b) => b.product), ["SKU1", "SKU2"]);
  const cat = await db.js_incoming_log.findFirstOrThrow({ where: { il_user_id: uid, il_type: "catalogue" } });
  assert.equal(JSON.parse(cat.il_response ?? "{}").product, "SKU2");

  // 7. flow answer (wawebhook variant logs the form URL, and forwards the raw payload when u_send_app = 1)
  await setUser({ u_send_app: 1 });
  const flow = incoming("wamid.IN7", { type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { response_json: `{"rating":"5"}`, name: "flow" } } });
  await processWebhook(flow, {}, "wa");
  await setUser({ u_send_app: 2 });
  assert.deepEqual(bodies("/form")[0], { sender_name: "Ravi Test", sender_no: "9000000001", response: { rating: "5" }, message_id: "wamid.IN7", receiver_mobile_no: "9999999999" });
  assert.equal((await db.js_incoming_log.findFirstOrThrow({ where: { il_user_id: uid, il_type: "flow" } })).post_url, `${mock}/form`);
  assert.deepEqual(bodies("/app")[0], flow);
  assert.equal(bodies("/incoming").at(-1).message, "Form Response");

  // 8. delivery statuses -> queue -> applied to the sent message and its log
  const out = await db.js_message.create({
    data: { m_user_id: uid, m_is_incoming: 2, m_status: 3, m_mobile_no: "9000000002", m_msg_type: "text", m_message_id: "wamid.TESTQ1", m_created_on: 1 },
  });
  await db.log_js_message_log.create({ data: { ml_m_id: out.m_id, ml_wa_id: "wamid.TESTQ1", ml_user_id: uid } });
  const status = (id: string, s: string, errors?: unknown[]) =>
    waPayload({ statuses: [{ id, status: s, timestamp: "1", recipient_id: "919000000002", ...(errors ? { errors } : {}) }] });
  await processWebhook(status("wamid.TESTQ1", "delivered"), {}, "webhook");
  await processWebhook(status("wamid.TESTQ1", "failed", [{ code: 131049, title: "Healthy ecosystem engagement" }]), {}, "webhook");
  await processWebhook(status("wamid.TESTQ_UNKNOWN", "read"), {}, "webhook");
  const queued = await db.log_js_webhook_que.findMany({ where: { msg_id: { startsWith: "wamid.TESTQ" } }, orderBy: { id: "asc" } });
  assert.deepEqual(queued.map((q) => [q.status, q.error]), [["delivered", ""], ["failed", "Healthy ecosystem engagement"], ["read", ""]]);
  assert.equal(JSON.parse(queued[1].value ?? "{}").receipt_no, "919000000002");

  await applyWebhookQueue(() => {});
  const after = await db.js_message.findUniqueOrThrow({ where: { m_id: out.m_id } });
  assert.equal(after.m_delivery_status, "failed");
  assert.equal(after.m_status_response, "Healthy ecosystem engagement");
  assert.ok(after.m_updated_on > 1_700_000_000);
  assert.equal((await db.log_js_message_log.findFirstOrThrow({ where: { ml_m_id: out.m_id } })).ml_wa_status, "failed");
  const left = await db.log_js_webhook_que.findMany({ where: { msg_id: { startsWith: "wamid.TESTQ" } } });
  assert.deepEqual(left.map((q) => [q.msg_id, q.moved]), [["wamid.TESTQ_UNKNOWN", 2]], "applied rows deleted, unmatched kept as moved=2");

  // 9. calls events are logged
  await processWebhook(waPayload({ calls: [{ id: "c1" }] }, "calls"), {}, "webhook");
  assert.equal(await db.log_js_api_data_log.count({ where: { adl_url: "calls", adl_value: { contains: PHONE_ID } } }), 1);

  // 10. no WhatsApp/Meta call was made by any of the above (no auto-reply rule for this user)
  assert.equal(calls.filter((c) => c.path.includes("/messages")).length, 0);

  // 11. report e-mails render and send in dry-run mode
  const report = await waReportHtml();
  assert.match(report, /WhatsApp Summary as on/);
  assert.match(report, /User Template Report/);
  assert.match(await templateReportHtml(uid), /WhatsApp Summary Till Date/);
  const mail = await sendMail({ to: { email: "test@example.test" }, subject: "t", html: report });
  assert.equal(mail.dryRun, true);

  // 12. media cleanup keeps today's folder only
  const wa = path.join(process.env.MEDIA_ROOT, "wa_msg");
  const { istParts } = await import("../src/lib/config");
  const today = istParts().yymmdd;
  for (const d of ["200101", "251231", today, "notadate"]) mkdirSync(path.join(wa, d), { recursive: true });
  assert.equal(await deleteOldMediaFolders(() => {}), 2);
  assert.deepEqual(["200101", "251231", today, "notadate"].map((d) => existsSync(path.join(wa, d))), [false, false, true, true]);

  // 13. routes on the dev server (same URLs as PHP), if it is running
  let routes = "skipped (dev server not running)";
  const ping = await fetch("http://localhost:3000/waapi/webhook.php?hub.mode=subscribe&hub.verify_token=x&hub.challenge=987").catch(() => null);
  if (ping) {
    assert.equal(await ping.text(), "987");
    for (const p of ["wawebhook", "newwebhook", "igwebhook"]) {
      assert.equal(await (await fetch(`http://localhost:3000/waapi/${p}.php?hub.challenge=55`)).text(), "55");
    }
    const res = await fetch("http://localhost:3000/waapi/webhook.php", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(status("wamid.TESTQ_ROUTE", "sent")),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).status, "200");
    assert.equal(await db.log_js_webhook_que.count({ where: { msg_id: "wamid.TESTQ_ROUTE" } }), 1);
    routes = "ok";
  }

  await cleanup();
  await db.$disconnect();
  server.close();
  console.log(`PASS: webhooks, status queue, reports, cleanup; route checks ${routes}`);
}

main().catch((e) => {
  console.error("FAIL:", e);
  server.close();
  process.exit(1);
});
