// /waapi/newwebhook.php — same URL as the PHP app, so the Meta app settings stay unchanged.
import { verifyOnlyWebhook } from "@/lib/wa/webhook-route";

export const dynamic = "force-dynamic";
const handler = verifyOnlyWebhook;
export const GET = handler.GET;
export const POST = handler.POST;
