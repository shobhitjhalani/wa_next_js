// Turns an action handler into Next.js route handlers (GET/POST/OPTIONS), like the PHP
// scripts which accepted any method and always answered with CORS headers.
import { jsonResponse, readLegacyRequest, textResponse, type LegacyRequest } from "./legacy";
import type { ApiOutput } from "./actions";

export function legacyRoute(handler: (req: LegacyRequest, raw: Request) => Promise<ApiOutput>) {
  const run = async (req: Request) => {
    const out = await handler(await readLegacyRequest(req), req);
    return "text" in out ? textResponse(req, out.text) : jsonResponse(req, out.json);
  };
  return { GET: run, POST: run, OPTIONS: run };
}
