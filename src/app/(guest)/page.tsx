import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/AuthCard';
import { LoginForm } from '@/components/LoginForm';
import { getUser } from '@/lib/auth';
import { config } from '@/lib/config';
import { loginUser } from './actions';

export const metadata: Metadata = { title: 'Sign In' };

/** User panel sign-in at the site root (legacy index.php). */
export default async function LoginPage() {
  if (await getUser()) redirect('/dashboard');
  return (
    <AuthCard tagline="WhatsApp Tool">
      <LoginForm action={loginUser} subtitle={`Sign in to continue to ${config.appName}.`} />
    </AuthCard>
  );
}
