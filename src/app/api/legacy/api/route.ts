// waapi/api.php. Reached at /api/secure/v1/<at>/, /wa/secure/v1/<at>-<uk>/ and
// /waapi/api.php?at=<at> through rewrites in next.config.ts.
import { handleApi } from "@/lib/api/actions";
import { legacyRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";

export const { GET, POST, OPTIONS } = legacyRoute(handleApi);
