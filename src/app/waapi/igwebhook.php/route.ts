// /waapi/igwebhook.php — same URL as the PHP app, so the Meta app settings stay unchanged.
import { instagramWebhook } from "@/lib/wa/webhook-route";

export const dynamic = "force-dynamic";
const handler = instagramWebhook;
export const GET = handler.GET;
export const POST = handler.POST;
