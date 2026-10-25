'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import ThemeToggle from '@/app/theme-toggle';

type VisitorEntry = {
  timestamp: string;
  ip: string | null;
  page: string;
  userAgent: string | null;
  deviceType: string;
  browser: string;
  operatingSystem: string;
  referrer: string | null;
};

type VisitorLogResponse = {
  entries: VisitorEntry[];
  total: number;
  uniqueIps: number;
  offset: number;
  limit: number;
};

type AccessState = 'checking' | 'anonymous' | 'owner' | 'restricted';
const PAGE_SIZE = 100;

async function readResponse<T>(response: Response): Promise<T> {
  let data: { error?: string } & T;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server returned an unreadable response.');
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

export default function VisitorLogPage() {
  const [access, setAccess] = useState<AccessState>('checking');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [entries, setEntries] = useState<VisitorEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [uniqueIps, setUniqueIps] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadEntries = useCallback(async (nextOffset: number) => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/admin/visitor-log?offset=${nextOffset}&limit=${PAGE_SIZE}`, { cache: 'no-store' });
      const data = await readResponse<VisitorLogResponse>(response);
      setEntries(data.entries);
      setTotal(data.total);
      setUniqueIps(data.uniqueIps);
      setOffset(data.offset);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the visitor log.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/auth', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data: { authenticated?: boolean; role?: string }) => {
        if (!active) return;
        if (!data.authenticated) {
          setAccess('anonymous');
        } else if (data.role === 'owner') {
          setAccess('owner');
          void loadEntries(0);
        } else {
          setAccess('restricted');
        }
      })
      .catch(() => { if (active) setAccess('anonymous'); });
    return () => { active = false; };
  }, [loadEntries]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await readResponse<{ authenticated: boolean; role: string }>(response);
      setPassword('');
      if (data.role !== 'owner') {
        setAccess('restricted');
        setError('Visitor log access is limited to the owner account.');
        return;
      }
      setAccess('owner');
      await loadEntries(0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in.');
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    setEntries([]);
    setAccess('anonymous');
    setPassword('');
    setError('');
  }

  if (access === 'checking') {
    return <main className="wrap admin-shell"><div className="admin-loading"><span className="loading-dot" /> Checking owner access…</div></main>;
  }

  if (access === 'anonymous') {
    return (
      <main className="admin-login-shell">
        <div className="admin-login-theme"><ThemeToggle /></div>
        <section className="admin-login-card">
          <Link href="/" className="brand"><span className="brand-mark">R</span> Restaurant</Link>
          <p className="eyebrow">OWNER ACCESS</p>
          <h1>Visitor IP log</h1>
          <p className="muted">Sign in with your owner account to view private visitor records.</p>
          <form onSubmit={signIn} className="admin-login-form">
            <label className="field"><span>Email</span><input autoComplete="username" type="email" maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label className="field"><span>Password</span><input autoComplete="current-password" type="password" maxLength={256} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            {error && <p className="admin-error" role="alert">{error}</p>}
            <button className="btn admin-login-submit" type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in securely'} <span aria-hidden="true">→</span></button>
          </form>
          <Link className="login-back-link" href="/admin">← Back to admin dashboard</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="wrap admin-shell visitor-log-shell">
      <header className="admin-header">
        <Link href="/" className="brand"><span className="brand-mark">R</span> Restaurant <span className="admin-label">OWNER</span></Link>
        <div className="admin-header-actions"><ThemeToggle /><Link className="plain-btn visitor-log-nav-link" href="/admin">Dashboard</Link><button className="plain-btn" type="button" onClick={() => void signOut()}>Sign out</button></div>
      </header>

      {access === 'restricted' ? (
        <section className="admin-panel visitor-log-panel">
          <p className="eyebrow">OWNER ACCESS</p>
          <h1>Visitor IP log</h1>
          <p className="muted">This page is available to the owner account only.</p>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <button className="plain-btn" type="button" onClick={() => void signOut()}>Sign out</button>
        </section>
      ) : (
        <>
          <section className="admin-welcome">
            <div><p className="eyebrow">PRIVATE OWNER REPORT</p><h1>Visitor IP log</h1><p className="muted">Page requests recorded by the website.</p></div>
            <button className="admin-refresh" type="button" onClick={() => void loadEntries(offset)} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
          </section>

          {error && <p className="admin-error admin-banner" role="alert">{error}</p>}

          <section className="admin-metrics" aria-label="Visitor log summary">
            <article className="metric-card"><span className="metric-label">Logged requests</span><strong>{total}</strong><small>All saved page visits</small></article>
            <article className="metric-card"><span className="metric-label">Distinct IP addresses</span><strong>{uniqueIps}</strong><small>Across the complete log</small></article>
          </section>

          <section className="admin-panel visitor-log-panel" aria-labelledby="visitor-log-title">
            <div className="admin-panel-heading list-heading"><div><p className="eyebrow">MOST RECENT FIRST</p><h2 id="visitor-log-title">Visitor records</h2><p className="muted">Timestamps use your browser’s local time.</p></div></div>
            {entries.length === 0 && !loading ? <p className="visitor-log-empty">No visitor entries have been recorded yet.</p> : (
              <div className="visitor-log-table-wrap">
                <table className="visitor-log-table">
                  <thead><tr><th scope="col">Timestamp</th><th scope="col">IP address</th><th scope="col">Requested page</th><th scope="col">Device type</th><th scope="col">Browser</th><th scope="col">Operating system</th><th scope="col">User agent</th><th scope="col">Referrer</th></tr></thead>
                  <tbody>{entries.map((entry, index) => (
                    <tr key={`${entry.timestamp}-${offset + index}`}>
                      <td>{new Date(entry.timestamp).toLocaleString()}</td>
                      <td><code>{entry.ip || 'Unavailable'}</code></td>
                      <td><code>{entry.page}</code></td>
                      <td>{entry.deviceType}</td>
                      <td>{entry.browser}</td>
                      <td>{entry.operatingSystem}</td>
                      <td>{entry.userAgent || '—'}</td>
                      <td>{entry.referrer || '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <div className="visitor-log-pagination">
              <span className="muted">{total === 0 ? '0 entries' : `Showing ${offset + 1}–${Math.min(offset + entries.length, total)} of ${total}`}</span>
              <div>
                <button className="admin-refresh" type="button" onClick={() => void loadEntries(Math.max(0, offset - PAGE_SIZE))} disabled={loading || offset === 0}>Newer</button>
                <button className="admin-refresh" type="button" onClick={() => void loadEntries(offset + PAGE_SIZE)} disabled={loading || offset + entries.length >= total}>Older</button>
              </div>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
