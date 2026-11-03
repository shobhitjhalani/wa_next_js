// /waapi/wawebhook.php — same URL as the PHP app, so the Meta app settings stay unchanged.
import { whatsappWebhook } from "@/lib/wa/webhook-route";

export const dynamic = "force-dynamic";
const handler = whatsappWebhook("wa");
export const GET = handler.GET;
export const POST = handler.POST;
