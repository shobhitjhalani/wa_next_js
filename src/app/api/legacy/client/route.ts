// waapi/client_api.php (rewritten from /waapi/client_api.php).
import { handleClientApi } from "@/lib/api/actions";
import { legacyRoute } from "@/lib/api/route";

export const dynamic = "force-dynamic";

export const { GET, POST, OPTIONS } = legacyRoute(handleClientApi);
