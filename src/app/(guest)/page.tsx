import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/AuthCard';
import { LoginForm } from '@/components/LoginForm';
import { getAccount } from '@/lib/auth';
import { memberHome } from '@/lib/team';
import { config } from '@/lib/config';
import { loginUser } from './actions';

export const metadata: Metadata = { title: 'Sign In' };

/** User panel sign-in at the site root (legacy index.php). */
export default async function LoginPage() {
  const account = await getAccount();
  if (account) redirect(account.member ? memberHome(account.perms) : '/dashboard');
  return (
    <AuthCard tagline="WhatsApp Tool">
      <LoginForm action={loginUser} subtitle={`Sign in to continue to ${config.appName}.`} />
    </AuthCard>
  );
}
