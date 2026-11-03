// Shared request handling for the /waapi/*webhook.php route handlers.
import { NextResponse, type NextRequest } from "next/server";
import { processWebhook, type WebhookVariant } from "./inbound";
import { appLog } from "./webhook-store";

/** PHP's $_REQUEST turns "hub.challenge" into "hub_challenge". */
export function phpQuery(req: NextRequest): Record<string, string> {
  const q: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => (q[k.replace(/\./g, "_")] = v));
  return q;
}

/** Meta's subscription check: echo hub.challenge back as plain text. */
const challenge = (q: Record<string, string>) =>
  q.hub_challenge !== undefined ? new NextResponse(q.hub_challenge, { headers: { "content-type": "text/plain" } }) : null;

async function readJson(req: NextRequest): Promise<{ raw: string; json: unknown }> {
  const raw = await req.text();
  try {
    return { raw, json: raw ? JSON.parse(raw) : null };
  } catch {
    return { raw, json: null };
  }
}

const parameterMissing = () => NextResponse.json({ status: "0", msg: "Parameter Missing", data: [] });

/** webhook.php / wawebhook.php */
export function whatsappWebhook(variant: WebhookVariant) {
  return {
    async GET(req: NextRequest) {
      return challenge(phpQuery(req)) ?? parameterMissing();
    },
    async POST(req: NextRequest) {
      const q = phpQuery(req);
      const { json } = await readJson(req);
      try {
        const result = await processWebhook(json, q, variant);
        return challenge(q) ?? NextResponse.json(result);
      } catch (e) {
        // A 500 makes Meta retry later instead of losing the event.
        console.error(`[waapi/${variant}] webhook failed`, e);
        return NextResponse.json({ status: "0", msg: "Server error", data: [] }, { status: 500 });
      }
    },
  };
}

/** newwebhook.php: verification only. */
export const verifyOnlyWebhook = {
  async GET(req: NextRequest) {
    return challenge(phpQuery(req)) ?? new NextResponse("");
  },
  async POST(req: NextRequest) {
    return challenge(phpQuery(req)) ?? new NextResponse("");
  },
};

/** igwebhook.php: Instagram events are only logged. */
export const instagramWebhook = {
  async GET(req: NextRequest) {
    const q = phpQuery(req);
    await appLog("instagram", "", 0);
    return challenge(q) ?? new NextResponse("");
  },
  async POST(req: NextRequest) {
    const q = phpQuery(req);
    const { raw } = await readJson(req);
    await appLog("instagram", raw, 0);
    return challenge(q) ?? new NextResponse("");
  },
};
