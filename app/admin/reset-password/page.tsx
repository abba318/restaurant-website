import type { Metadata } from 'next';
import PasswordResetForm from '@/components/password-reset-form';

export const metadata: Metadata = {
  title: 'Reset staff password',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : '';
  return <PasswordResetForm token={token} />;
}
