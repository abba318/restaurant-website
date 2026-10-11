'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import ThemeToggle from '@/components/theme-toggle';

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Could not reset your password.');
  return data as T;
}

export default function PasswordResetForm({ token }: { token: string }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token && window.location.search) window.history.replaceState(null, '', '/admin/reset-password');
  }, [token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (newPassword !== confirmPassword) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try {
      await readResponse(await fetch('/api/admin/password-reset/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword, confirmPassword }),
      }));
      setComplete(true); setNewPassword(''); setConfirmPassword('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reset your password. Request a new link and try again.');
    } finally { setBusy(false); }
  }

  return (
    <main className="admin-login-shell">
      <div className="admin-login-theme"><ThemeToggle /></div>
      <section className="admin-login-card">
        <Link href="/" className="brand"><span className="brand-mark">R</span> Restaurant</Link>
        <p className="eyebrow">STAFF ACCESS</p>
        <h1>{complete ? 'Password updated' : 'Reset your password'}</h1>
        {complete ? <>
          <p className="muted">Your password has been changed. Sign in with your new password.</p>
          <Link className="btn admin-login-submit reset-login-link" href="/admin">Return to staff sign in</Link>
        </> : !token ? <>
          <p className="admin-error" role="alert">This reset link is missing or invalid. Request a new one from staff sign in.</p>
          <Link className="btn admin-login-submit reset-login-link" href="/admin">Back to staff sign in</Link>
        </> : <>
          <p className="muted">Choose a password with at least 12 characters.</p>
          <form onSubmit={submit} className="admin-login-form">
            <label className="field"><span>New password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
            <label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label>
            {error && <p className="admin-error" role="alert">{error}</p>}
            <button className="btn admin-login-submit" type="submit" disabled={busy}>{busy ? 'Updating…' : 'Set new password'} <span aria-hidden="true">→</span></button>
          </form>
          <Link className="login-back-link" href="/admin">← Back to staff sign in</Link>
        </>}
      </section>
    </main>
  );
}
