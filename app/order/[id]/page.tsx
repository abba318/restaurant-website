'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import ThemeToggle from '@/components/theme-toggle';

type Item = { name: string; quantity: number; price_kobo: number; special_request?: string };
type Data = { order: { id: string; customer_name: string; customer_email: string; customer_phone: string; delivery_address: string; delivery_instructions: string; fulfillment_type: string; items: Item[]; total_kobo: number; delivery_fee_kobo: number; status: string; payment_status: string; payment_reference?:string; created_at: string }; settings: { name?: string; address?: string; phone?: string; email?: string; logoUrl?: string; receiptFooter?: string }; history: { status: string; changed_by: string; changed_at: string }[] };
const price = (amount: number) => `₦${(amount / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const flow = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered'];
const label = (status: string) => ({ pending: 'Received', confirmed: 'Confirmed', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'Out for delivery', delivered: 'Delivered', completed: 'Completed', cancelled: 'Cancelled' }[status] || status.replaceAll('_', ' '));

export default function OrderReceipt({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [qrData, setQrData] = useState('');
  useEffect(() => { let active = true; const load = () => fetch(`/api/orders/${encodeURIComponent(id)}`, { cache: 'no-store' }).then(async (r) => { const body = await r.json(); if (!r.ok) throw new Error(body.error || 'Unable to load this order.'); return body as Data; }).then((value) => { if (active) setData(value); }).catch((e) => { if (active) setError(e.message); }); void load(); const timer = window.setInterval(load, 20000); return () => { active = false; window.clearInterval(timer); }; }, [id]);
  const verifyUrl = data ? `${typeof window === 'undefined' ? process.env.NEXT_PUBLIC_APP_URL : window.location.origin}/verify/${data.order.id}` : '';
  useEffect(() => { if (!verifyUrl) return; let live = true; QRCode.toDataURL(verifyUrl, { width: 240, margin: 1, errorCorrectionLevel: 'M' }).then((value) => { if (live) setQrData(value); }).catch(() => undefined); return () => { live = false; }; }, [verifyUrl]);
  if (error) return <main className="wrap receipt-wrap"><p role="alert">{error}</p><Link href="/">Return to menu</Link></main>;
  if (!data) return <main className="wrap receipt-wrap" aria-live="polite">Loading your order…</main>;
  const { order, settings, history } = data;
  const orderNo = order.id.slice(0, 8).toUpperCase();
  const date = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(order.created_at));
  const current = flow.indexOf(order.status);
  return <main className="wrap receipt-wrap">
    <div className="receipt-actions"><Link href="/orders">← My orders</Link><div className="receipt-actions-right"><ThemeToggle /><button className="btn" onClick={() => window.print()}>Print receipt</button></div></div>
    <div className="receipt-layout">
      <section className="receipt-card" aria-label="Order receipt">
        <header className="receipt-head">{settings.logoUrl && <img src={settings.logoUrl} alt="" />}<h1>{settings.name || 'Restaurant'}</h1><p>{settings.address}</p><p>{settings.phone}{settings.email ? ` · ${settings.email}` : ''}</p><h2>ORDER RECEIPT</h2></header>
        <div className="receipt-meta"><span>Order <b>#{orderNo}</b></span><span>{date}</span></div>
        <div className="receipt-customer"><b>{order.customer_name}</b><span>{order.customer_phone}</span><span>{order.fulfillment_type === 'pickup' ? 'Pickup' : order.delivery_address}</span>{order.delivery_instructions && <small>Instructions: {order.delivery_instructions}</small>}</div>
        <div className="receipt-items">{order.items.map((item, i) => <div className="receipt-line" key={`${item.name}-${i}`}><span>{item.quantity} × {item.name}{item.special_request && <small className="receipt-special-request">Special request: {item.special_request}</small>}</span><b>{price(item.price_kobo * item.quantity)}</b></div>)}</div>
        <div className="receipt-line"><span>{order.fulfillment_type === 'pickup' ? 'Pickup' : 'Delivery fee'}</span><b>{price(order.delivery_fee_kobo)}</b></div>
        <div className="receipt-total"><span>Total</span><b>{price(order.total_kobo)}</b></div>
        <p className="receipt-payment">Payment: <strong>{order.payment_status.toUpperCase()}</strong>{order.payment_reference && <><br/>Reference: {order.payment_reference}</>}</p>
        <div className="receipt-verify">{qrData ? <img src={qrData} alt={`QR code to verify order ${orderNo}`} /> : <span className="receipt-qr-fallback">Order verification<br/><b>#{orderNo}</b></span>}<span>Scan to verify order<br/><b>#{orderNo}</b><br/>{settings.receiptFooter || 'Thank you for your order.'}</span></div>
      </section>
      <aside className="tracking-card"><p className="eyebrow">ORDER TRACKING</p><h2 className={`current-order-status status-${(order.status || 'unknown').replaceAll('_', '-')}`}><i aria-hidden="true" />{label(order.status || 'Status unavailable')}</h2><ol className="tracking-steps">{flow.filter((s) => order.fulfillment_type === 'pickup' ? s !== 'out_for_delivery' : true).map((status) => { const index = flow.indexOf(status); return <li key={status} className={current >= index ? 'done' : ''}><span />{label(status)}</li>; })}</ol>{order.status === 'cancelled' && <p>This order was cancelled. Contact the restaurant if you need help.</p>}<h3>Status history</h3><ul className="history-list">{history.map((entry, i) => <li key={`${entry.changed_at}-${i}`}><b>{label(entry.status)}</b><span>{entry.changed_by} · {new Intl.DateTimeFormat('en-NG', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.changed_at))}</span></li>)}</ul><p className="muted">Updates automatically every 20 seconds.</p></aside>
    </div>
    <style jsx global>{`@media print { @page { size: A4; margin: 12mm } body { background: white !important } .receipt-wrap { max-width:none!important;padding:0!important } .receipt-actions,.tracking-card { display:none!important } .receipt-layout { display:block!important } .receipt-card { box-shadow:none!important;border:0!important;margin:0 auto!important;width:100%!important } .receipt-head { padding-top:0!important } .receipt-verify img { width:32mm!important;height:32mm!important } } @media print and (max-width: 90mm) { @page { size: 80mm auto; margin: 3mm } .receipt-card { width:74mm!important;font-size:10px!important;padding:4mm!important } .receipt-head h1 { font-size:18px!important } .receipt-line,.receipt-meta { font-size:10px!important } .receipt-verify img { width:24mm!important;height:24mm!important } }`}</style>
  </main>;
}
