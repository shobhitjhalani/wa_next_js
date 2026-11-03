import CorporateUsersReport from "@/components/admin/CorporateUsersReport";
import { getAdmin } from "@/lib/admin/guard";
import type { SearchParams } from "@/lib/admin/params";

export const dynamic = "force-dynamic";

// wamaster/view/reports/users.php
export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const admin = await getAdmin({ superAdmin: true });
  return <CorporateUsersReport admin={admin} sp={await searchParams} detailed={true} />;
}
