'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import KitchenInventory from '@/components/kitchen-inventory';
import StaffMessages from '@/components/staff-messages';
import ThemeToggle from '@/components/theme-toggle';

type KitchenItem = { name: string; quantity: number; special_request?: string };
type KitchenOrder = { id: string; customer_name: string; customer_phone: string; fulfillment_type: 'delivery' | 'pickup'; items: KitchenItem[]; status: string; created_at: string };

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Kitchen screen request failed.');
  return data as T;
}

const formatTime = (date: string) => new Intl.DateTimeFormat('en-NG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(date));

export default function KitchenPage() {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [error, setError] = useState('');
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const activeOrderCount = orders.filter((order) => order.status !== 'ready').length;

  const loadOrders = useCallback(async () => {
    try {
      const data = await readResponse<{ orders: KitchenOrder[] }>(await fetch('/api/admin/kitchen/orders', { cache: 'no-store' }));
      setOrders(data.orders);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load kitchen orders.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/auth', { cache: 'no-store' })
      .then((response) => readResponse<{ authenticated: boolean; role: string }>(response))
      .then((data) => {
        if (!active) return;
        if (!data.authenticated) { window.location.replace('/admin'); return; }
        if (data.role !== 'kitchen') { window.location.replace('/admin'); return; }
        setAuthenticated(true);
        setChecking(false);
        void loadOrders();
      })
      .catch(() => { if (active) { setError('Could not check your kitchen staff sign-in.'); setChecking(false); } });
    return () => { active = false; };
  }, [loadOrders]);

  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadOrders(); }, 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, loadOrders]);

  async function updateOrder(id: string, status: 'preparing' | 'ready') {
    setBusyOrder(id); setError('');
    try {
      await readResponse(await fetch(`/api/admin/kitchen/orders/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      }));
      await loadOrders();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update this order.');
    } finally { setBusyOrder(null); }
  }

  async function logout() {
    await fetch('/api/admin/auth', { method: 'DELETE' });
    window.location.assign('/admin');
  }

  if (checking) return <main className="kitchen-shell"><p className="kitchen-loading">Checking kitchen staff access…</p></main>;

  return (
    <main className="kitchen-shell">
      <header className="kitchen-header">
        <div><p className="eyebrow">PREPARATION QUEUE</p><h1>Kitchen</h1><p>Paid orders, with meal requests shown beside each dish.</p></div>
        <div className="kitchen-header-actions"><span className="kitchen-count">{activeOrderCount} active</span><ThemeToggle /><button className="plain-btn" onClick={logout}>Sign out</button></div>
      </header>
      {error && <p className="admin-error kitchen-error" role="alert">{error}</p>}
      <div className="kitchen-toolbar"><span>Active count excludes ready orders. Queue refreshes every 5 seconds.</span><button className="admin-refresh" onClick={() => void loadOrders()}>↻ Refresh queue</button></div>
      <KitchenInventory />
      <StaffMessages orders={orders} />
      {orders.length === 0 ? <section className="kitchen-empty"><span aria-hidden="true">✓</span><h2>Kitchen is clear</h2><p>New paid orders will appear here.</p></section> : <section className="kitchen-orders" aria-label="Paid orders waiting in the kitchen">
        {orders.map((order) => (
          <article className={`kitchen-ticket kitchen-ticket-${order.status}`} key={order.id}>
            <header><div><span className="kitchen-order-id">#{order.id.slice(0, 8).toUpperCase()}</span><h2>{order.customer_name}</h2><p>{order.fulfillment_type === 'pickup' ? 'Pickup' : 'Delivery'} · {order.customer_phone || 'No phone number'}</p></div><span className="kitchen-status">{order.status.replaceAll('_', ' ')}</span></header>
            <p className="kitchen-time">Placed {formatTime(order.created_at)}</p>
            <ul className="kitchen-item-list">{order.items.map((item, index) => <li key={`${item.name}-${index}`}><div><strong>{item.quantity} × {item.name}</strong>{item.special_request && <p className="kitchen-special-request"><b>Special request:</b> {item.special_request}</p>}</div></li>)}</ul>
            <footer>{order.status !== 'preparing' && order.status !== 'ready' && <button className="btn" type="button" disabled={busyOrder === order.id} onClick={() => void updateOrder(order.id, 'preparing')}>{busyOrder === order.id ? 'Saving…' : 'Start preparing'}</button>}{order.status === 'preparing' && <button className="btn" type="button" disabled={busyOrder === order.id} onClick={() => void updateOrder(order.id, 'ready')}>{busyOrder === order.id ? 'Saving…' : 'Mark ready'}</button>}</footer>
          </article>
        ))}
      </section>}
      <footer className="kitchen-footer"><Link href="/">Customer storefront ↗</Link></footer>
    </main>
  );
}
