'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type OrderOption = { id: string; customer_name: string };
type StaffMessage = { id: string | number; sender_email: string; sender_role: string; body: string; order_id: string | null; order_customer_name?: string | null; created_at: string };

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Staff messages are unavailable.');
  return data as T;
}

const formatTime = (date: string) => new Intl.DateTimeFormat('en-NG', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(date));

export default function StaffMessages({ orders }: { orders: OrderOption[] }) {
  const [messages, setMessages] = useState<StaffMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [orderId, setOrderId] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const loadMessages = useCallback(async () => {
    try {
      const data = await readResponse<{ messages: StaffMessage[] }>(await fetch('/api/admin/messages', { cache: 'no-store' }));
      setMessages(data.messages);
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load staff messages.'); }
  }, []);

  useEffect(() => {
    void loadMessages();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadMessages(); }, 5000);
    return () => window.clearInterval(timer);
  }, [loadMessages]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message) return;
    setSending(true); setError('');
    try {
      await readResponse(await fetch('/api/admin/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, orderId: orderId || null }),
      }));
      setDraft(''); setOrderId('');
      await loadMessages();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to send message.'); }
    finally { setSending(false); }
  }

  return (
    <section className="admin-panel staff-messages" aria-labelledby="staff-messages-title">
      <div className="admin-panel-heading"><div><p className="eyebrow">TEAM INBOX</p><h2 id="staff-messages-title">Staff messages</h2><p className="muted">Messages are shared across the admin, staff, and kitchen dashboards. Attach an order to pass it to the team.</p></div><button className="admin-refresh" type="button" onClick={() => void loadMessages()}>↻ Refresh chat</button></div>
      {error && <p className="admin-error" role="alert">{error}</p>}
      <div className="staff-message-list" role="log" aria-live="polite" aria-label="Shared staff chat">
        {messages.length === 0 ? <p className="muted">No staff messages yet.</p> : messages.map((item) => <article className="staff-message" key={item.id}>
          <div className="staff-message-meta"><strong>{item.sender_email}</strong><span>{item.sender_role}</span><time dateTime={item.created_at}>{formatTime(item.created_at)}</time></div>
          {item.order_id && <p className="staff-message-order">Order #{item.order_id.slice(0, 8).toUpperCase()}{item.order_customer_name ? ` · ${item.order_customer_name}` : ''}</p>}
          <p>{item.body}</p>
        </article>)}
      </div>
      <form className="staff-message-form" onSubmit={sendMessage}>
        {orders.length > 0 && <label className="field"><span>Attach an order (optional)</span><select value={orderId} onChange={(event) => setOrderId(event.target.value)}><option value="">Team message only</option>{orders.map((order) => <option key={order.id} value={order.id}>#{order.id.slice(0, 8).toUpperCase()} · {order.customer_name}</option>)}</select></label>}
        <label className="field"><span>Message</span><textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={1000} rows={2} placeholder="Send a note to the team…" required /></label>
        <button className="btn" type="submit" disabled={sending || !draft.trim()}>{sending ? 'Sending…' : orderId ? 'Send message with order' : 'Send message'}</button>
      </form>
    </section>
  );
}
