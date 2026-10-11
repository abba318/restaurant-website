'use client';

import Script from 'next/script';
import { FormEvent, useCallback, useEffect, useState } from 'react';

type Item = { id?: number; name?: string; quantity?: number; price_kobo?: number };
type Order = { id: string; customer_name: string; customer_email: string; customer_phone: string; fulfillment_type: string; delivery_address: string; items: Item[]; total_kobo: number; status: string; payment_status: string; created_at: string; emailSent?: boolean | null; emailError?: string };
type TelegramWebApp = { ready: () => void; expand: () => void; colorScheme?: string };
declare global { interface Window { Telegram?: { WebApp?: TelegramWebApp } } }

const statuses = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed', 'cancelled'];
const money = (value: number) => `₦${(Number(value || 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nice = (value: string) => value.replaceAll('_', ' ');

async function responseData<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data as T;
}

export default function TelegramMiniApp() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('');

  const loadOrders = useCallback(async () => {
    const result = await responseData<{ orders: Order[] }>(await fetch('/api/admin/orders', { cache: 'no-store' }));
    setOrders(result.orders);
    setAuthenticated(true);
  }, []);

  useEffect(() => {
    window.Telegram?.WebApp?.ready();
    window.Telegram?.WebApp?.expand();
    fetch('/api/admin/auth', { cache: 'no-store' }).then(responseData<{ authenticated: boolean }>).then(async (result) => {
      setAuthenticated(result.authenticated);
      if (result.authenticated) await loadOrders();
    }).catch(() => setAuthenticated(false));
  }, [loadOrders]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await responseData(await fetch('/api/admin/auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }));
      setPassword(''); await loadOrders();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign in failed.'); }
    finally { setBusy(false); }
  }

  async function changeStatus(order: Order, status: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await responseData<Order>(await fetch(`/api/admin/orders/${encodeURIComponent(order.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }));
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, ...updated } : item));
      setNotice(updated.emailSent === true ? `Status updated. Email sent to ${order.customer_email}.` : updated.emailSent === false ? `Status updated, but email failed: ${updated.emailError || 'check Gmail settings'}` : 'Order status updated.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update order.'); }
    finally { setBusy(false); }
  }

  async function logout() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    setAuthenticated(false); setOrders([]); setNotice('');
  }

  return <>
    <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
    <main className="tg-miniapp">
      <header className="tg-header"><div><span className="tg-kicker">RESTAURANT ADMIN</span><h1>Orders</h1></div>{authenticated && <button className="tg-refresh" onClick={() => void loadOrders()} aria-label="Refresh orders">↻</button>}</header>
      {authenticated === null && <p className="tg-muted">Opening your dashboard…</p>}
      {authenticated === false && <form className="tg-login" onSubmit={login}><p className="tg-muted">Sign in with your existing dashboard account.</p><label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><button className="tg-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button></form>}
      {error && <p className="tg-alert" role="alert">{error}</p>}{notice && <p className="tg-notice" role="status">{notice}</p>}
      {authenticated && <>
        <div className="tg-toolbar"><span>{orders.length} recent orders</span><select aria-label="Filter by status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All statuses</option>{statuses.map((status) => <option key={status} value={status}>{nice(status)}</option>)}</select></div>
        <section className="tg-orders">{orders.filter((order) => !filter || order.status === filter).map((order) => <article className="tg-order" key={order.id}>
          <div className="tg-order-head"><div><span className="tg-order-id">ORDER · {order.id.slice(0, 8).toUpperCase()}</span><h2>{order.customer_name}</h2><a href={`mailto:${encodeURIComponent(order.customer_email)}`}>{order.customer_email}</a>{order.customer_phone && <a href={`tel:${order.customer_phone}`}>{order.customer_phone}</a>}</div><strong>{money(order.total_kobo)}</strong></div>
          <ul className="tg-items">{(order.items || []).map((item, index) => <li key={`${item.id || item.name}-${index}`}><span>{item.quantity || 1} × {item.name || 'Item'}</span><span>{money((item.price_kobo || 0) * (item.quantity || 1))}</span></li>)}</ul>
          <div className="tg-order-meta"><span>{order.payment_status} · {order.fulfillment_type}</span><span>{new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(order.created_at))}</span></div>
          <label className="tg-status">Order status<select disabled={busy} value={order.status} onChange={(event) => void changeStatus(order, event.target.value)}>{statuses.filter((status) => order.fulfillment_type !== 'pickup' || status !== 'out_for_delivery').map((status) => <option key={status} value={status}>{nice(status)}</option>)}</select></label>
        </article>)}{orders.length === 0 && <p className="tg-muted">No orders found.</p>}</section>
        <button className="tg-logout" onClick={() => void logout()}>Sign out</button>
      </>}
    </main>
    <style jsx global>{`
      body:has(.tg-miniapp){background:#f6f2eb}.tg-miniapp{max-width:720px;min-height:100vh;margin:auto;padding:calc(18px + env(safe-area-inset-top)) 16px calc(30px + env(safe-area-inset-bottom));color:#29271f;font-family:Arial,sans-serif}.tg-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}.tg-header h1{font:600 34px Georgia,serif;margin:3px 0}.tg-kicker,.tg-order-id{font-size:10px;letter-spacing:.12em;color:#7b766d;font-weight:700}.tg-refresh{width:42px;height:42px;border:0;border-radius:50%;background:#454545;color:white;font-size:25px}.tg-toolbar{display:flex;align-items:center;justify-content:space-between;margin:15px 0;color:#716b62;font-size:13px}.tg-toolbar select,.tg-status select{border:1px solid #ded8cd;background:white;border-radius:9px;padding:11px;color:#29271f}.tg-orders{display:grid;gap:13px}.tg-order,.tg-login{background:white;border:1px solid #e9e2d7;border-radius:15px;padding:16px;box-shadow:0 6px 20px #4938190a}.tg-order-head{display:flex;justify-content:space-between;gap:10px}.tg-order-head h2{font-size:18px;margin:5px 0}.tg-order-head a{display:block;color:#777064;font-size:12px;margin-top:3px;text-decoration:none}.tg-order-head strong{font-size:15px;white-space:nowrap}.tg-items{list-style:none;padding:12px 0;margin:12px 0;border-top:1px solid #eee9e1;border-bottom:1px solid #eee9e1}.tg-items li{display:flex;justify-content:space-between;gap:8px;padding:4px 0;font-size:13px}.tg-order-meta{display:flex;justify-content:space-between;gap:8px;color:#817b70;font-size:11px}.tg-status{display:grid;gap:6px;margin-top:14px;font-size:12px;font-weight:700}.tg-status select{width:100%;font-size:14px;text-transform:capitalize}.tg-muted{color:#79736a;font-size:13px}.tg-login{display:grid;gap:13px}.tg-login label{display:grid;gap:6px;font-size:13px;font-weight:700}.tg-login input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #ded8cd;border-radius:9px;font-size:16px}.tg-primary{padding:13px;border:0;border-radius:9px;background:#454545;color:#fff;font-weight:700;font-size:15px}.tg-alert,.tg-notice{padding:12px;border-radius:9px;font-size:13px;line-height:1.4}.tg-alert{background:#fff0ed;color:#a53220}.tg-notice{background:#edf6ee;color:#424242}.tg-logout{margin:20px 0;padding:10px;border:0;background:transparent;color:#766f64}.tg-primary:disabled,.tg-status select:disabled{opacity:.65}
    `}</style>
  </>;
}
