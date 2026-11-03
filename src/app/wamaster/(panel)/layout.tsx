import { getAdmin } from "@/lib/admin/guard";

// Every /wamaster/* page except the login page (/wamaster) and /wamaster/logout.
// Pages call getAdmin() again for their own data; this is a second line of defence.
export default async function AdminPanelLayout({ children }: { children: React.ReactNode }) {
  await getAdmin();
  return children;
}
