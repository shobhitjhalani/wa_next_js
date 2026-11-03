import { NextResponse } from "next/server";
import { routeUser } from "@/lib/user/http";
import { getTemplate, templateView } from "@/lib/user/templates";

// templates_content.php: preview (ty=1) and parameter/header inputs (ty=2) for a template.
// Returns JSON; the compose form renders both parts from it.
export async function GET(req: Request) {
  const auth = await routeUser(req, { mutating: false });
  if ("error" in auth) return auth.error;
  const id = Number(new URL(req.url).searchParams.get("id") ?? 0);
  const t = await getTemplate(auth.userId, id);
  if (!t) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  return NextResponse.json(templateView(t));
}
