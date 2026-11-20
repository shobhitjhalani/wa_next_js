import type { Metadata } from 'next';
import Link from 'next/link';
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
      <div className="mt-4 pt-3 border-top text-center">
        <p className="mb-0 text-muted">Not an administrator? <Link href="/" className="fw-semibold text-primary text-decoration-underline">User sign in <i className="ri-arrow-right-line align-middle" /></Link></p>
      </div>
    </AuthCard>
  );
}
