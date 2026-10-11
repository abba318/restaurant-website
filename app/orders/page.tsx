'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import ThemeToggle from '@/components/theme-toggle';
import { getSavedOrderIds } from '@/lib/order-history';

type SavedOrder = { id: string; created_at: string; status: string; payment_status: string; total_kobo: number; fulfillment_type: string; items: { name: string; quantity: number }[] };
const money = (amount: number) => `₦${(amount / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const statusLabel = (status: string) => status ? ({ pending: 'Received', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'Out for delivery', delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled' }[status] || status.replaceAll('_', ' ')) : 'Status unavailable';

export default function OrdersPage() {
  const [orders, setOrders] = useState<SavedOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      let cookieOrders: SavedOrder[] = [];
      let requestFailed = false;
      try {
        const response = await fetch('/api/orders', { cache: 'no-store' });
        if (!response.ok) throw new Error('Order history unavailable');
        const data = await response.json();
        cookieOrders = Array.isArray(data.orders) ? data.orders : [];
      } catch { requestFailed = true; }
      const ids = getSavedOrderIds().filter((id) => !cookieOrders.some((order) => order.id === id));
      const results = await Promise.all(ids.map(async (id) => {
        try {
          const response = await fetch(`/api/orders/${encodeURIComponent(id)}`, { cache: 'no-store' });
          if (!response.ok) return null;
          const data = await response.json();
          return data.order as SavedOrder;
        } catch { return null; }
      }));
      if (active) {
        const allOrders = [...cookieOrders, ...results.filter((order): order is SavedOrder => Boolean(order))];
        setOrders(allOrders.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)));
        setFailed(requestFailed && allOrders.length === 0);
        setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  return <main className="wrap receipt-wrap">
    <div className="receipt-actions"><Link href="/">← Menu</Link><h1>My orders</h1><ThemeToggle /></div>
    <p className="muted">Orders placed from this browser are saved securely to this device. Select an order to see its receipt and live status.</p>
    {loading ? <p aria-live="polite">Loading your orders…</p> : failed ? <p role="alert">Your saved orders could not be loaded right now. Please try again later.</p> : orders.length === 0 ? <section className="empty-cart card"><h2>No saved orders yet</h2><p className="muted">After you place an order, you can return here to track it.</p><Link className="btn" href="/#menu">Browse the menu</Link></section> : <div className="order-list" style={{ marginTop: 24 }}>
      {orders.map((order) => <Link className="admin-order" key={order.id} href={`/order/${order.id}`} style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
        <div className="order-topline"><div><span className="order-id">ORDER #{order.id.slice(0, 8).toUpperCase()}</span><span className={`order-status-chip status-${order.status || 'unknown'}`}><i aria-hidden="true" />{statusLabel(order.status)}</span><p className="muted">{new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(order.created_at))}</p></div><strong>{money(order.total_kobo)}</strong></div>
        <p className="muted">{order.fulfillment_type === 'pickup' ? 'Pickup' : 'Delivery'} · {order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')} · Payment {order.payment_status}</p>
        <span className="view-order-cta">View order <span aria-hidden="true">→</span></span>
      </Link>)}
    </div>}
  </main>;
}
