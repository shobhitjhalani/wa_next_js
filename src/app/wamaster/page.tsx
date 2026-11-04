import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/AuthCard';
import { LoginForm } from '@/components/LoginForm';
import { getAdmin } from '@/lib/auth';
import { config } from '@/lib/config';
import { loginAdmin } from './actions';

export const metadata: Metadata = { title: 'Admin Sign In' };

/** Admin panel sign-in (/wamaster). */
export default async function AdminLoginPage() {
  if (await getAdmin()) redirect('/wamaster/dashboard');
  return (
    <AuthCard tagline="Administration Panel">
      <LoginForm action={loginAdmin} subtitle={`Sign in to the ${config.appName} admin panel.`} />
    </AuthCard>
  );
}
