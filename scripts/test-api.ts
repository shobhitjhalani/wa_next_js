// Tests the partner APIs ported from waapi/api.php, client_api.php and shopify.php.
//  1. Over HTTP against the dev server (old URLs, auth, every action, DB rows).
//  2. In-process with a MOCK WhatsApp API for the paths that send immediately (bot/OTP/Shopify).
// Nothing reaches Meta or Shopify. Uses the claude_test user and numbers 9000000xxx; cleans up.
//   npx tsx scripts/test-api.ts            (dev server must be running on :3000)
import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import assert from "node:assert/strict";

const BASE = process.env.API_BASE ?? "http://localhost:3000";
const MARK = "TEST_API"; // m_sheet_id of rows created through the API

const metaCalls: { path: string; body: any }[] = [];
const meta = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    metaCalls.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : {} });
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ messages: [{ id: `wamid.API${metaCalls.length}` }] }));
  });
});

async function post(url: string, body?: unknown, opts: { form?: Record<string, string>; headers?: Record<string, string> } = {}) {
  const init: RequestInit = { method: "POST", headers: { ...opts.headers } };
  if (opts.form) {
    init.body = new URLSearchParams(opts.form).toString();
    (init.headers as Record<string, string>)["content-type"] = "application/x-www-form-urlencoded";
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)["content-type"] = "application/json";
  }
  const res = await fetch(BASE + url, { ...init, redirect: "manual" });
  const text = await res.text();
  let json: any = undefined;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, text, json };
}

async function main() {
  await new Promise<void>((r) => meta.listen(0, r));
  const tmp = mkdtempSync(path.join(tmpdir(), "wa-api-test-"));
  process.env.WA_API_URL = `http://127.0.0.1:${(meta.address() as AddressInfo).port}/`;
  process.env.MEDIA_ROOT = path.join(tmp, "media");
  process.env.WAAPI_MEDIA_ROOT = path.join(tmp, "waapi");

  const { db } = await import("../src/lib/db");
  const { handleApi } = await import("../src/lib/api/actions");
  const { handleShopify } = await import("../src/lib/api/shopify");

  const user = await db.js_user.findFirstOrThrow({ where: { u_username: "claude_test" } });
  const uid = user.u_id;
  await db.js_user.update({
    where: { u_id: uid },
    data: {
      u_access_code: "CLTEST", u_code: "CLTEST", u_type: 2, u_status: 1, u_dstatus: 0, u_wa_plan_status: 1,
      u_parent_id: 9999, u_wa_phone_id: "PHONE123", u_wa_b_id: "WABA123",
    },
  });
  const createdIds: bigint[] = [];
  const msgs = () => db.js_message.findMany({ where: { m_user_id: uid, m_sheet_id: { in: [MARK, "API", "shopify"] } }, orderBy: { m_id: "asc" } });
  const latest = async () => {
    const r = await db.js_message.findFirstOrThrow({ where: { m_user_id: uid }, orderBy: { m_id: "desc" } });
    createdIds.push(r.m_id);
    return r;
  };

  let passed = 0;
  const check = async (name: string, fn: () => Promise<void>) => {
    await fn();
    passed++;
    console.log(`ok  ${name}`);
  };

  try {
    // ---------------------------------------------------------------- envelope / routing
    await check("missing action -> Parameter Missing", async () => {
      assert.deepEqual((await post("/waapi/api.php")).json, { status: "0", message: "Parameter Missing", result: [] });
    });
    await check("unknown action -> Invalid Request", async () => {
      assert.deepEqual((await post("/api/secure/v1/nope/")).json, { status: 0, message: "Invalid Request ", result: [] });
    });
    await check("trailing-slash API URL is not redirected", async () => {
      assert.equal((await post("/api/secure/v1/nope/")).status, 200);
    });

    // ---------------------------------------------------------------- auth
    await check("send_message: bad access key -> 202", async () => {
      const r = await post("/api/secure/v1/send_message/", { access_key: "WRONG", receiverMobileNo: "9000000001", message: "x" });
      assert.deepEqual(r.json, { status: "202", message: "202 : Invalid Username", result: { id: "0", status: "Invalid Username" } });
    });
    await check("send_message: wrong password -> 202", async () => {
      const r = await post("/api/secure/v1/send_message/", { username: "claude_test", password: "bad", receiverMobileNo: "9000000001", message: "x" });
      assert.equal(r.json.status, "202");
    });
    await check("send_message: expired plan -> 207", async () => {
      await db.js_user.update({ where: { u_id: uid }, data: { u_wa_plan_status: 2 } });
      const r = await post("/api/secure/v1/send_message/", { access_key: "CLTEST", receiverMobileNo: "9000000001", message: "x" });
      await db.js_user.update({ where: { u_id: uid }, data: { u_wa_plan_status: 1 } });
      assert.deepEqual(r.json, { status: "207", message: "207 : User WA Plan Expired", result: { id: "0", status: "User WA Plan Expired" } });
    });

    // ---------------------------------------------------------------- queueing
    let uniqueId = "";
    await check("send_message (access key) queues a text row", async () => {
      const r = await post("/api/secure/v1/send_message/", {
        access_key: "CLTEST", receiverMobileNo: ["9000000001"], message: ["Hi 'Ravi' \"VIP\" 😊"],
        filePathUrl: ["https://cdn.test/a.jpg", "https://cdn.test/b.pdf"], messageButtons: ["Yes,No"], title: "T",
        sheet_id: MARK, msg_values: { a: 1 }, urlButtons: "https://x.test/?q=1",
      });
      assert.equal(r.json.status, "200");
      assert.equal(r.json.message, "Success");
      assert.match(r.json.result.id, /^[0-9a-f-]{36}$/);
      uniqueId = r.json.result.id;
      const m = await latest();
      assert.equal(m.m_status, 1);
      assert.equal(m.m_msg_type, "text");
      assert.equal(m.m_unique_id, uniqueId);
      assert.equal(m.m_content, "Hi &#39;Ravi&#39; &#34;VIP&#34; 😊");
      assert.equal(m.m_mobile_no, "9000000001");
      assert.equal(m.m_image, "https://cdn.test/a.jpg,https://cdn.test/b.pdf");
      assert.equal(m.m_buttons, "Yes,No");
      assert.equal(m.m_msg_title, "T");
      assert.equal(m.m_msg_values, "{&#34;a&#34;:1}");
      assert.equal(m.m_button_url, "https://x.test/?q=1");
      assert.equal(m.m_source, 2);
      assert.ok(m.m_contact_id > 0, "contact created");
      assert.match(m.m_title ?? "", /^\d{2}-[A-Z][a-z]{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
    });
    await check("status_wa returns the delivery status by unique id", async () => {
      await db.js_message.updateMany({ where: { m_unique_id: uniqueId }, data: { m_delivery_status: "delivered" } });
      const r = await post("/api/secure/v1/status_wa/", { message_id: uniqueId });
      assert.deepEqual(r.json, { status: "200", message: "Success", result: "delivered" });
    });
    await check("create_wa (password) + base64File saves the attachment", async () => {
      const files = [{ name: "doc.pdf", extension: "pdf", body: Buffer.from("%PDF").toString("base64") }];
      const r = await post("/api/secure/v1/create_wa/", {
        username: "CLAUDE_TEST", password: "Test@123", receiverMobileNo: "9000000002", message: "Bill", base64File: files, sheet_id: MARK,
      });
      assert.equal(r.json.status, "200");
      const m = await latest();
      assert.match(m.m_base_file ?? "", /^CLTEST_\d{7}_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}\.json$/);
      const saved = path.join(process.cwd(), "storage", "waapi-media", m.m_base_file!);
      assert.ok(existsSync(saved), "base file written where the sender reads it");
      assert.deepEqual(JSON.parse(readFileSync(saved, "utf8")), files);
      unlinkSync(saved);
    });
    await check("type / opt flags: opt=1 -> Authentication, in-process stamped", async () => {
      const r = await post("/wa/secure/v1/send_message-CLTEST/", {
        access_key: "CLTEST", receiverMobileNo: "9000000003", template: "otp", template_parameters: "123456", opt: 1, sheet_id: MARK,
      });
      assert.equal(r.json.status, "200");
      const m = await latest();
      assert.equal(m.m_msg_type, "Authentication");
      assert.equal(m.m_msg_template_name, "otp");
      assert.ok(m.m_in_process_on > 0);
    });
    await check("send_template queues a template row (sheet API, empty content)", async () => {
      const r = await post("/api/secure/v1/send_template/", {
        access_key: "CLTEST", receiverMobileNo: "9000000004", template: "promo", template_parameters: "A,B", attachment: "https://cdn.test/x.jpg",
      });
      assert.deepEqual(r.json, { status: "200", message: "Success", result: { id: "0", status: "Success" } });
      const m = await latest();
      assert.equal(m.m_msg_type, "template");
      assert.equal(m.m_sheet_id, "API");
      assert.equal(m.m_content, "");
      assert.equal(m.m_image, "https://cdn.test/x.jpg");
      assert.equal(m.m_status, 1);
    });
    await check("create_wa_test returns the numeric row id", async () => {
      const r = await post("/api/secure/v1/create_wa_test/", { username: "claude_test", password: "Test@123", receiverMobileNo: "9000000005", message: "t", sheet_id: MARK });
      const m = await latest();
      assert.deepEqual(r.json, { status: "200", message: "Success", result: { id: Number(m.m_id), status: "Success" } });
      assert.equal(m.m_msg_type, "1");
    });
    await check("create_wa_reply / create_wa_reply_all message types", async () => {
      await post("/api/secure/v1/create_wa_reply/", { username: "claude_test", password: "Test@123", receiverMobileNo: "9000000006", message: "r", sheet_id: MARK });
      assert.equal((await latest()).m_msg_type, "1");
      await post("/api/secure/v1/create_wa_reply_all/", { username: "claude_test", password: "Test@123", receiverMobileNo: "9000000007", message: "r", sheet_id: MARK });
      assert.equal((await latest()).m_msg_type, "template");
    });
    await check("create_log writes the API log", async () => {
      const before = await db.log_js_api_data_log.count({ where: { adl_url: "create_log" } });
      const r = await post("/api/secure/v1/create_log/", { hello: "world" });
      assert.deepEqual(r.json, { status: 0, message: "Invalid Request ", result: [] });
      assert.equal(await db.log_js_api_data_log.count({ where: { adl_url: "create_log" } }), before + 1);
      await db.log_js_api_data_log.deleteMany({ where: { adl_url: "create_log", adl_value: { contains: '"hello":"world"' } } });
    });
    await check("groups and legacy incoming answer as unsupported", async () => {
      assert.equal((await post("/api/secure/v1/get_group/", {})).json.status, "501");
      assert.equal((await post("/api/secure/v1/update_group/", {})).json.status, "501");
      assert.equal((await post("/wa/secure/v1/incoming-CLTEST/", undefined, { form: { jsonData: "{}" } })).json.message, "Invalid Request ");
    });

    // ---------------------------------------------------------------- sheets add-on
    const email = "claude_test_api@example.test";
    await db.js_user_emails.deleteMany({ where: { ue_email_id: email } });
    const ue = await db.js_user_emails.create({ data: { ue_user_id: uid, ue_email_id: email } });
    const sheetId = `TESTSHEET_${Date.now()}`;
    await check("sheet_activate / sheet_status", async () => {
      assert.deepEqual((await post("/api/secure/v1/sheet_activate/", undefined, { form: { userEmail: "bad" } })).json, { status: 1001, message: "Invalid Email ID", result: [] });
      const a = await post("/api/secure/v1/sheet_activate/", undefined, { form: { userEmail: email, sheetId, sheetType: "1" } });
      assert.deepEqual(a.json, { status: "1", message: "Sheet Successfully Activated", result: [] });
      const again = await post("/api/secure/v1/sheet_activate/", undefined, { form: { userEmail: email, sheetId } });
      assert.deepEqual(again.json, { status: 1, message: "Sheet Already Active", result: [] });
      const s = await post("/api/secure/v1/sheet_status/", undefined, { form: { userEmail: email, sheetId } });
      assert.deepEqual(s.json, { status: 1, message: "Sheet is Active", result: { user_email: email } });
      const s2 = await post("/api/secure/v1/sheet_status/", undefined, { form: { userEmail: "nobody@example.test", sheetId } });
      assert.deepEqual(s2.json, { status: 0, message: "Invalid Email ID", result: { user_email: "" } });
    });
    await db.js_user_active_sheets.deleteMany({ where: { us_sheet_id: sheetId } });
    await db.js_user_emails.delete({ where: { ue_id: ue.ue_id } });

    // ---------------------------------------------------------------- data extractor (plain text)
    const key = `CLTEST-DEK-${Date.now()}`;
    await db.js_user_data_extractor_keys.create({ data: { dek_user_id: uid, dek_key: key } });
    await check("check/activate/deactivate_js_de", async () => {
      const call = async (at: string, k = key) => (await post(`/api/secure/v1/${at}/`, undefined, { form: { key: k } })).text;
      assert.equal(await call("check_js_de", "NOPE"), "Invalid Activation Key");
      assert.equal(await call("check_js_de"), "OK");
      assert.equal(await call("activate_js_de"), "OK");
      assert.equal(await call("activate_js_de"), "Activation Key Already Login");
      assert.equal(await call("deactivate_js_de"), "");
      assert.equal(await call("deactivate_js_de"), "Invalid Activation Key");
    });
    await db.js_user_data_extractor_keys.deleteMany({ where: { dek_key: key } });

    // ---------------------------------------------------------------- client_api / shopify routing
    await check("client_api rejects a wrong Api-Key", async () => {
      const r = await post("/waapi/client_api.php?at=send_wa", {}, { headers: { "Api-Key": "wrong" } });
      assert.deepEqual(r.json, { status: "0", message: "Parameter Missing", result: [], msg: "Invalid credential", data: [] });
    });
    await check("shopify: order without phone -> null; unknown action -> empty", async () => {
      assert.equal((await post("/api/shopify/v1/new_order/", { name: "#1" })).text, "null");
      assert.equal((await post("/waapi/shopify.php?at=other", {})).text, "");
    });

    // ---------------------------------------------------------------- immediate send (mock Meta, in-process)
    const req = (at: string, json: Record<string, unknown>) => ({ request: { at }, post: {}, json, raw: JSON.stringify(json), headers: new Headers() });
    await check("bot=1 is sent immediately (status 3, Meta called)", async () => {
      const out: any = await handleApi(req("send_message", { access_key: "CLTEST", receiverMobileNo: "9000000008", message: "bot reply", bot: 1, sheet_id: MARK }));
      assert.equal(out.json.status, "200");
      const m = await latest();
      assert.equal(m.m_status, 3);
      assert.match(m.m_message_id ?? "", /^wamid\.API\d+$/);
      const call = metaCalls.find((c) => c.body.to === "919000000008");
      assert.deepEqual(call?.body.text, { preview_url: "false", body: "bot reply" });
    });
    await check("shopify new_order + abandoned_cart send templates", async () => {
      const order = { phone: "+91 90000 00009".replace(/ /g, ""), name: "#1042", billing_address: { name: "Asha" }, order_status_url: "https://www.uare.co/orders/abc?key=1" };
      const r1: any = await handleShopify("new_order", JSON.stringify(order), {}, uid);
      assert.equal(r1.status, "200");
      const t1 = metaCalls.filter((c) => c.body.to === "919000000009").at(-1)!.body.template;
      assert.equal(t1.name, "order_confirmation");
      assert.deepEqual(t1.components[0].parameters.map((p: any) => p.text), ["Asha", "1042"]);
      createdIds.push((await latest()).m_id);
      const r2: any = await handleShopify("abandoned_cart", JSON.stringify(order), {}, uid);
      assert.equal(r2.status, "200");
      const m = await latest();
      assert.equal(m.m_button_url, "/orders/abc?key=1");
      assert.equal(m.m_status, 3);
      const t2 = metaCalls.filter((c) => c.body.to === "919000000009").at(-1)!.body.template;
      assert.equal(t2.name, "abandoned_checkout");
      assert.equal(t2.components.at(-1).sub_type, "url");
    });

    console.log(`\nPASS: ${passed} checks, ${(await msgs()).length} API rows, ${metaCalls.length} mock Meta calls`);
  } finally {
    const ids = [...new Set([...createdIds, ...(await msgs()).map((m) => m.m_id)])];
    await db.log_js_message_log.deleteMany({ where: { ml_m_id: { in: ids } } });
    await db.js_message.deleteMany({ where: { m_id: { in: ids } } });
    await db.js_user_contact_list.deleteMany({ where: { cl_user_id: uid, cl_mobile_no: { startsWith: "9000000" } } });
    await db.$disconnect();
    meta.close();
  }
}

main().catch((e) => {
  console.error("FAIL:", e);
  meta.close();
  process.exit(1);
});
