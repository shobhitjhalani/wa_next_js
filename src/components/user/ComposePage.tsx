import ComposeForm from "./ComposeForm";
import PageShell, { Card } from "./PageShell";
import { PREVIEW_CSS } from "./previewCss";
import { now } from "@/lib/config";
import { db } from "@/lib/db";
import { decodeEntities } from "@/lib/user/format";

// Body of compose.php / create.php / scheduler.php (they are copies of one form).
export default async function ComposePage({
  title,
  userId,
  tm,
  mobile,
  action,
}: {
  title: string;
  userId: number;
  tm: number;
  mobile: string;
  action: (prev: string, form: FormData) => Promise<string>;
}) {
  const templates = await db.js_user_templates.findMany({
    where: { ut_user_id: userId, ut_dstatus: 0, ...(tm > 0 ? { ut_id: tm } : {}) },
    orderBy: { ut_id: "desc" },
    select: { ut_id: true, ut_name: true },
  });
  return (
    <PageShell title={title}>
      <style>{PREVIEW_CSS}</style>
      <Card>
        <div className="card-body">
          <ComposeForm
            templates={templates.map((t) => ({ id: t.ut_id, title: decodeEntities(t.ut_name) }))}
            selected={tm}
            mobile={mobile}
            ucode={`cu_${now()}_${userId}`}
            action={action}
          />
        </div>
      </Card>
    </PageShell>
  );
}
