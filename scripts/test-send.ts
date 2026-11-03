// Integration test for the queue + send engine against a MOCK WhatsApp API.
// Nothing is sent to Meta: WA_API_URL is pointed at a local server started here.
// Uses the local test user `claude_test` and fake numbers 9000000xxx; cleans up after.
//   npx tsx scripts/test-send.ts
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";

type Captured = { path: string; body: Record<string, any> };
const calls: Captured[] = [];

const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    calls.push({ path: req.url ?? "", body });
    res.setHeader("content-type", "application/json");
    if (body.to === "919000000099") {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: { message: "(#131026) Message undeliverable", code: 131026 } }));
    }
    res.end(JSON.stringify({ messages: [{ id: `wamid.TEST${calls.length}` }] }));
  });
});

async function main() {
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as AddressInfo).port;

  const tmp = mkdtempSync(path.join(tmpdir(), "wa-test-"));
  process.env.WA_API_URL = `http://127.0.0.1:${port}/`;
  process.env.MEDIA_ROOT = path.join(tmp, "media");
  process.env.WAAPI_MEDIA_ROOT = path.join(tmp, "waapi");
  process.env.MEDIA_URL = "https://wa.example.test/media/";
  mkdirSync(process.env.WAAPI_MEDIA_ROOT, { recursive: true });
  writeFileSync(
    path.join(process.env.WAAPI_MEDIA_ROOT, "test_base.json"),
    JSON.stringify([{ name: "Invoice (Nov) 'A'", extension: "pdf", body: Buffer.from("%PDF-1.4 test").toString("base64") }]),
  );

  // Import after env is set: config is read at import time.
  const { db } = await import("../src/lib/db");
  const { claim } = await import("../src/worker/queue");
  const { sendClaimedMessages, MsgStatus } = await import("../src/lib/wa/sender");

  const user = await db.js_user.findFirstOrThrow({ where: { u_username: "claude_test" } });
  await db.js_user.update({
    where: { u_id: user.u_id },
    data: { u_parent_id: 9999, u_wa_phone_id: "PHONE123", u_wa_b_id: "WABA123", u_type: 2, u_wa_plan_status: 1, u_status: 1 },
  });
  const uid = user.u_id;
  await db.js_message.deleteMany({ where: { m_user_id: uid } });
  await db.js_user_block_list.deleteMany({ where: { ubl_user_id: uid } });
  await db.js_user_block_list.create({ data: { ubl_user_id: uid, ubl_mobile_no: "9000000098" } });

  const t = Math.floor(Date.now() / 1000);
  const base = { m_user_id: uid, m_is_incoming: 2, m_status: 1, m_created_on: t, m_dstatus: 0 };
  const fixtures = {
    text: { m_mobile_no: "9000000001", m_msg_type: "text", m_content: "Hello &#39;world&#34; 😊" },
    buttons: { m_mobile_no: "9000000002", m_msg_type: "text", m_content: "Pick", m_buttons: "Yes,No", m_image: "https://cdn.test/car.jpg" },
    list: { m_mobile_no: "9000000003", m_msg_type: "text", m_content: "Menu", m_buttons: "A,B,C,D" },
    template: {
      m_mobile_no: "9000000004", m_msg_type: "template", m_msg_template_name: "west_ev_nov",
      m_msg_template_para: "Ravi,15 Nov", m_image: "https://cdn.test/brochure.pdf", m_button_url: "https://x.test/p?id=5&ref=wa a",
    },
    marketing: { m_mobile_no: "9000000005", m_msg_type: "template", m_msg_template_name: "promo", m_msg_lite: 1 },
    flow: { m_mobile_no: "9000000006", m_msg_type: "flow", m_msg_template_name: "feedback", m_msg_template_para: "Ravi" },
    auth: { m_mobile_no: "9000000007", m_msg_type: "Authentication", m_msg_template_name: "otp", m_msg_template_para: "482913" },
    basefile: { m_mobile_no: "9000000008", m_msg_type: "text", m_content: "Your invoice", m_base_file: "test_base.json" },
    blocked: { m_mobile_no: "9000000098", m_msg_type: "text", m_content: "x" },
    failing: { m_mobile_no: "9000000099", m_msg_type: "text", m_content: "x" },
    oldQueued: { m_mobile_no: "9000000010", m_msg_type: "text", m_content: "too old", m_created_on: t - 30 * 86400 },
  };
  const ids: Record<string, bigint> = {};
  for (const [k, v] of Object.entries(fixtures)) {
    ids[k] = (await db.js_message.create({ data: { ...base, ...v } })).m_id;
  }

  // Claim like a lane does, then claim again: the second claim must get nothing.
  const since = t - 3 * 86400;
  const claimed = await claim(uid, 100, since);
  assert.equal(claimed.length, Object.keys(fixtures).length - 1, "claims all recent queued messages, not the old one");
  assert.equal((await claim(uid, 100, since)).length, 0, "already-claimed messages cannot be claimed twice");

  let sent = 0;
  for (const msgId of claimed) sent += await sendClaimedMessages({ msgId, userId: uid, variant: "meta" });

  const byTo = (n: string) => calls.filter((c) => c.body.to === `91${n}`);
  const row = (k: string) => db.js_message.findUniqueOrThrow({ where: { m_id: ids[k] } });

  // text
  assert.deepEqual(byTo("9000000001")[0], {
    path: "/PHONE123/messages",
    body: { messaging_product: "whatsapp", recipient_type: "individual", to: "919000000001", type: "text", text: { preview_url: "false", body: "Hello 'world\" 😊" } },
  });
  // buttons + image header (single request, image in header)
  const b = byTo("9000000002");
  assert.equal(b.length, 1);
  assert.equal(b[0].body.interactive.type, "button");
  assert.deepEqual(b[0].body.interactive.header, { type: "image", image: { link: "https://cdn.test/car.jpg" } });
  assert.deepEqual(b[0].body.interactive.action.buttons.map((x: any) => x.reply.id), ["btn1", "btn2"]);
  // >3 buttons -> list
  const l = byTo("9000000003")[0].body.interactive;
  assert.equal(l.type, "list");
  assert.equal(l.action.sections[0].rows.length, 4);
  // template: rename, header doc, body params, url button
  const tp = byTo("9000000004")[0].body.template;
  assert.equal(tp.name, "west_nov_ex");
  assert.deepEqual(tp.components[0], { type: "header", parameters: [{ type: "document", document: { link: "https://cdn.test/brochure.pdf", filename: "brochure.pdf" } }] });
  assert.deepEqual(tp.components[1].parameters.map((p: any) => p.text), ["Ravi", "15 Nov"]);
  assert.equal(tp.components[2].parameters[0].text, "?id=5&ref=wa+a");
  // msg_lite -> marketing endpoint
  assert.equal(byTo("9000000005")[0].path, "/PHONE123/marketing_messages");
  // flow
  assert.deepEqual(byTo("9000000006")[0].body.template.components.at(-1), { type: "button", sub_type: "flow", index: "0" });
  // auth: code is the button text
  assert.equal(byTo("9000000007")[0].body.template.components[1].parameters[0].text, "482913");
  // base file decoded, saved, sent as a document with caption
  const bf = byTo("9000000008")[0].body;
  assert.equal(bf.type, "document");
  assert.equal(bf.document.caption, "Your invoice");
  assert.equal(bf.document.filename, "Invoice_Nov_A.pdf");
  assert.match(bf.document.link, /^https:\/\/wa\.example\.test\/media\/wa_msg\/\d{6}\/CLTEST\/Invoice_Nov_A\.pdf$/);
  // blocked -> no API call, Opt Out
  assert.equal(byTo("9000000098").length, 0);

  const statuses = Object.fromEntries(await Promise.all(Object.keys(fixtures).map(async (k) => [k, (await row(k)).m_status])));
  assert.deepEqual(statuses, {
    text: MsgStatus.Sent, buttons: MsgStatus.Sent, list: MsgStatus.Sent, template: MsgStatus.Sent, marketing: MsgStatus.Sent,
    flow: MsgStatus.Sent, auth: MsgStatus.Sent, basefile: MsgStatus.Sent,
    blocked: MsgStatus.OptOut, failing: MsgStatus.Cancelled, oldQueued: MsgStatus.InQueue,
  });
  const textRow = await row("text");
  assert.match(textRow.m_message_id ?? "", /^wamid\.TEST\d+$/);
  assert.equal(textRow.m_delivery_status, "sent");
  assert.equal(await db.log_js_message_log.count({ where: { ml_m_id: { in: Object.values(ids) } } }), claimed.length);
  assert.equal(sent, claimed.length);

  console.log(`PASS: ${claimed.length} messages, ${calls.length} mock API calls, all payloads and statuses as expected`);

  await db.log_js_message_log.deleteMany({ where: { ml_m_id: { in: Object.values(ids) } } });
  await db.js_message.deleteMany({ where: { m_user_id: uid } });
  await db.js_user_block_list.deleteMany({ where: { ubl_user_id: uid } });
  await db.$disconnect();
  server.close();
}

main().catch((e) => {
  console.error("FAIL:", e);
  server.close();
  process.exit(1);
});
