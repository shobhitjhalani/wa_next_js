// /waapi/webhook.php — same URL as the PHP app, so the Meta app settings stay unchanged.
import { whatsappWebhook } from "@/lib/wa/webhook-route";

export const dynamic = "force-dynamic";
const handler = whatsappWebhook("webhook");
export const GET = handler.GET;
export const POST = handler.POST;
