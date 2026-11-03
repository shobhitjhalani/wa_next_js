import PageShell, { Card } from "@/components/user/PageShell";
import { currentUser } from "@/lib/user/current";

// whatsapp.php was the QR-code login of the old unofficial gateway (WA_API_SOURCE 1/2,
// localhost:5000). The official Cloud API has no QR login: numbers are connected with
// "Login with Facebook" on the dashboard. This page only shows the connection.
export default async function WhatsAppPage() {
  const user = await currentUser();
  return (
    <PageShell title="QR Code">
      <Card>
        <div className="card-body">
          {user.u_wa_phone_id ? (
            <p>Connected : {user.u_wa_no}</p>
          ) : (
            <p>
              Not connected. Use <a href="/dashboard">Login with Facebook</a> on the dashboard to connect your WhatsApp
              number.
            </p>
          )}
        </div>
      </Card>
    </PageShell>
  );
}
