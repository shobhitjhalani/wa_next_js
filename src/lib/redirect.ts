/**
 * Redirect from a route handler with a relative Location header. Behind nginx,
 * req.url is the internal address (localhost:3000), so absolute URLs built from
 * it send browsers to the wrong host; a relative Location keeps the host and
 * scheme the browser used.
 */
export function redirectTo(path: string, status = 307): Response {
  return new Response(null, { status, headers: { Location: path } });
}
