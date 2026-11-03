import { redirect } from "next/navigation";
import AuthShell from "@/components/AuthShell";
import LoginForm from "@/components/LoginForm";
import { loginUser } from "@/lib/auth";
import { config } from "@/lib/config";
import { getUserSession } from "@/lib/session";

// User login (index.php).
async function login(_prev: string, form: FormData): Promise<string> {
  "use server";
  const username = String(form.get("txtusername") ?? "").trim();
  const password = String(form.get("txtpassword") ?? "");
  if (!username) return "Please enter username";
  if (!password) return "Please enter password";
  return loginUser(username, password);
}

export default async function LoginPage() {
  if ((await getUserSession()).userId) redirect("/dashboard");
  return (
    <AuthShell>
      <LoginForm action={login} siteName={config.siteName} />
    </AuthShell>
  );
}
