import { redirect } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import LoginForm from "@/components/LoginForm";
import { loginAdmin } from "@/lib/auth";
import { config } from "@/lib/config";
import { getAdminSession } from "@/lib/session";

// Admin login (wamaster/index.php).
async function login(_prev: string, form: FormData): Promise<string> {
  "use server";
  const username = String(form.get("txtusername") ?? "").trim();
  const password = String(form.get("txtpassword") ?? "");
  if (!username || !password) return "Invalid Username or Password";
  return loginAdmin(username, password);
}

export default async function AdminLoginPage() {
  if ((await getAdminSession()).empId) redirect("/wamaster/dashboard");
  return (
    <AuthShell>
      <LoginForm action={login} siteName={`${config.siteName} Admin`} />
    </AuthShell>
  );
}
