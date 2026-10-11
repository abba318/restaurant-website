import { pool } from '@/lib/db';
import nodemailer from 'nodemailer';

type Channel = 'email' | 'sms' | 'whatsapp';

function gmailTransport() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) throw new Error('Gmail is not configured on the server.');
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, '') },
  });
}

export async function sendAdminPasswordResetEmail(email: string, resetUrl: string) {
  const transport = gmailTransport();
  await transport.sendMail({
    from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
    to: email,
    subject: 'Reset your restaurant staff password',
    text: `A password reset was requested for your restaurant staff account.\n\nUse this link within 30 minutes to choose a new password:\n${resetUrl}\n\nIf you did not request this change, you can ignore this email. Your password has not been changed.`,
  });
}

export async function sendAdminPasswordChangedEmail(email: string) {
  const transport = gmailTransport();
  await transport.sendMail({
    from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
    to: email,
    subject: 'Your restaurant staff password was changed',
    text: 'Your restaurant staff account password was reset. If you did not make this change, contact the restaurant owner immediately.',
  });
}

export async function sendOrderStatusEmail(order: {
  id: string;
  customerName: string;
  customerEmail: string;
  items: Array<{ name?: string; quantity?: number; special_request?: string }>;
}, status: string) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    throw new Error('Gmail is not configured on the server.');
  }
  const transport = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ''),
    },
  });
  const items = Array.isArray(order.items) ? order.items : [];
  const itemLines = items.map((item) => `• ${String(item.name || 'Order item')} × ${Math.max(1, Number(item.quantity) || 1)}${item.special_request ? `\n  Special request: ${item.special_request.slice(0, 250).replace(/\s+/g, ' ')}` : ''}`);
  const readableStatus = status.replace(/[_-]+/g, ' ');
  await transport.sendMail({
    from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
    to: order.customerEmail,
    subject: `Order update: ${readableStatus} · ${order.id.slice(0, 8).toUpperCase()}`,
    text: `Hello ${order.customerName},\n\nYour order status is now: ${readableStatus}.\n\nItems in your order:\n${itemLines.join('\n') || 'Order details unavailable.'}\n\nThank you.`,
  });
}

/** Queue a paid order's notifications once, in the same transaction as the queue marker. */
export async function queuePaidOrderNotification(orderId: string) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT id,customer_name,customer_email,customer_phone,delivery_address,fulfillment_type,items,total_kobo,status,payment_status,location_latitude,location_longitude,paid_notification_queued_at FROM orders WHERE id=$1 FOR UPDATE',
      [orderId],
    );
    if (!result.rowCount || result.rows[0].payment_status !== 'paid' || result.rows[0].paid_notification_queued_at) {
      await client.query('COMMIT');
      return;
    }
    const order = result.rows[0];
    const customerPayload = JSON.stringify({ event: 'order_paid', orderId, status: order.status, paymentStatus: 'paid', totalKobo: Number(order.total_kobo) });
    const insert = 'INSERT INTO notification_outbox(order_id,channel,destination,payload) VALUES($1,$2,$3,$4)';
    if (order.customer_email) await client.query(insert, [orderId, 'email', order.customer_email, customerPayload]);
    if (order.customer_phone) {
      await client.query(insert, [orderId, 'sms', order.customer_phone, customerPayload]);
      await client.query(insert, [orderId, 'whatsapp', order.customer_phone, customerPayload]);
    }

    const latitude = order.location_latitude === null ? null : Number(order.location_latitude);
    const longitude = order.location_longitude === null ? null : Number(order.location_longitude);
    const hasLocation = order.fulfillment_type === 'delivery' && latitude !== null && longitude !== null
      && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
      && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    const admins = await client.query('SELECT telegram_user_id FROM admin_users WHERE telegram_user_id IS NOT NULL');
    const telegramPayload = JSON.stringify({
      event: 'new_order', orderId, customerName: order.customer_name, customerEmail: order.customer_email,
      customerPhone: order.customer_phone, deliveryAddress: order.delivery_address, fulfillmentType: order.fulfillment_type,
      items: order.items, totalKobo: Number(order.total_kobo), status: order.status, paymentStatus: 'paid',
      latitude: hasLocation ? latitude : null, longitude: hasLocation ? longitude : null,
    });
    for (const admin of admins.rows) {
      await client.query(insert, [orderId, 'telegram', admin.telegram_user_id, telegramPayload]);
      if (hasLocation) {
        const locationPayload = JSON.stringify({ event: 'order_location', orderId, latitude, longitude });
        await client.query(insert, [orderId, 'telegram', admin.telegram_user_id, locationPayload]);
      }
    }
    await client.query('UPDATE orders SET paid_notification_queued_at=NOW() WHERE id=$1', [orderId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function sendTelegram(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) throw new Error(`Telegram ${method} failed.`);
}

export async function dispatchNotifications(limit = 20) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const selected = await client.query("WITH batch AS (SELECT n.id FROM notification_outbox n LEFT JOIN orders o ON o.id=n.order_id WHERE n.state='pending' AND ((n.order_id IS NOT NULL AND o.payment_status='paid') OR (n.reservation_id IS NOT NULL AND n.channel='telegram')) ORDER BY CASE WHEN n.channel='telegram' THEN 0 ELSE 1 END,n.id FOR UPDATE OF n SKIP LOCKED LIMIT $1) UPDATE notification_outbox n SET state='processing' FROM batch WHERE n.id=batch.id RETURNING n.*", [Math.min(Math.max(limit, 1), 50)]);
    await client.query('COMMIT');
    const results = await Promise.all(selected.rows.map(async (row) => {
      if (row.channel === 'telegram') {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        if (!token) { await pool.query("UPDATE notification_outbox SET state='pending' WHERE id=$1", [row.id]); return { id: row.id, state: 'pending' }; }
        try {
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          if (payload.event === 'order_location') {
            const latitude = Number(payload.latitude);
            const longitude = Number(payload.longitude);
            if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) throw new Error('Invalid order location');
            await sendTelegram(token, 'sendLocation', { chat_id: row.destination, latitude, longitude });
          } else if (payload.event === 'new_order') {
            const items = Array.isArray(payload.items) ? payload.items : [];
            const itemLines = items.map((item: { name?: string; quantity?: number; price_kobo?: number; special_request?: string }) => {
              const quantity = Math.max(1, Number(item.quantity) || 1);
              const price = Math.max(0, Number(item.price_kobo) || 0) * quantity;
              const specialRequest = typeof item.special_request === 'string' ? item.special_request.replace(/\s+/g, ' ').slice(0, 250) : '';
              return `• ${quantity} × ${String(item.name || 'Item').slice(0, 120)} — ₦${(price / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${specialRequest ? `\n  Special request: ${specialRequest}` : ''}`;
            });
            const totalKobo = Math.max(0, Number(payload.totalKobo) || 0);
            const latitude = payload.latitude === null ? NaN : Number(payload.latitude);
            const longitude = payload.longitude === null ? NaN : Number(payload.longitude);
            const hasLocation = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
            const mapUrl = hasLocation ? `https://maps.google.com/?q=${latitude},${longitude}` : '';
            const address = String(payload.deliveryAddress || '');
            const addressPin = address.match(/https:\/\/maps\.google\.com\/\?q=-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/i)?.[0] || '';
            const lines = [
              `🆕 New order · ${String(payload.orderId || row.order_id).slice(0, 8).toUpperCase()}`,
              `Customer: ${String(payload.customerName || 'Customer').slice(0, 120)}`,
              `Phone: ${String(payload.customerPhone || 'not provided').slice(0, 40)}`,
              `Email: ${String(payload.customerEmail || 'not provided').slice(0, 160)}`,
              `Type: ${String(payload.fulfillmentType || 'delivery')} · ${String(payload.status || 'pending')} · ${String(payload.paymentStatus || 'unpaid')}`,
              ...itemLines,
              `Total: ₦${(totalKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
              ...(address ? [`Address: ${address.slice(0, 900)}`] : []),
              ...(mapUrl || addressPin ? [`Map: ${mapUrl || addressPin}`] : []),
            ];
            await sendTelegram(token, 'sendMessage', { chat_id: row.destination, text: lines.join('\n').slice(0, 3900) });
          } else if (payload.event === 'new_reservation') {
            const fee = Math.max(0, Number(payload.reservationFeeKobo) || 0);
            const paidOnline = payload.paymentStatus === 'paid';
            const notes = String(payload.notes || '').replace(/\s+/g, ' ').slice(0, 500);
            const lines = [
              `📅 New table reservation · #${String(payload.reservationId || row.reservation_id)}`,
              `Customer: ${String(payload.customerName || 'Customer').slice(0, 120)}`,
              `Phone: ${String(payload.customerPhone || 'not provided').slice(0, 40)}`,
              `Email: ${String(payload.customerEmail || 'not provided').slice(0, 160)}`,
              `Date: ${String(payload.reservationDate || '')} at ${String(payload.reservationTime || '')}`,
              `Guests: ${Math.min(20, Math.max(1, Number(payload.partySize) || 1))}`,
              `Fee: ${fee ? `₦${(fee / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${paidOnline ? ' · paid via Paystack' : ' · payable at the restaurant'}` : 'Free'}`,
              ...(notes ? [`Notes: ${notes}`] : []),
            ];
            await sendTelegram(token, 'sendMessage', { chat_id: row.destination, text: lines.join('\n').slice(0, 3900) });
          } else throw new Error('Unknown Telegram notification event');
          await pool.query("UPDATE notification_outbox SET state='sent',attempts=attempts+1,sent_at=NOW() WHERE id=$1", [row.id]);
          return { id: row.id, state: 'sent' };
        } catch {
          await pool.query("UPDATE notification_outbox SET state=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,attempts=attempts+1 WHERE id=$1", [row.id]);
          return { id: row.id, state: 'pending' };
        }
      }
      if (row.channel === 'email' && process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) {
        try {
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
          const transport = nodemailer.createTransport({
            service: 'gmail',
            auth: {
              user: process.env.GMAIL_USER,
              pass: process.env.GMAIL_APP_PASSWORD.replace(/\s+/g, ''),
            },
          });
          const eventName = String(payload.event ?? 'Order update').replace(/[_-]+/g, ' ');
          const orderId = String(payload.orderId ?? row.order_id);
          await transport.sendMail({
            from: process.env.GMAIL_FROM || process.env.GMAIL_USER,
            to: row.destination,
            subject: `${eventName} — order ${orderId}`,
            text: `Hello,\n\n${eventName} for your order ${orderId}.\n\n${Object.entries(payload)
              .filter(([key]) => !['event', 'orderId'].includes(key))
              .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
              .join('\n')}\n\nThank you.`,
          });
          await pool.query("UPDATE notification_outbox SET state='sent',attempts=attempts+1,sent_at=NOW() WHERE id=$1", [row.id]);
          return { id: row.id, state: 'sent' };
        } catch {
          await pool.query("UPDATE notification_outbox SET state=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,attempts=attempts+1 WHERE id=$1", [row.id]);
          return { id: row.id, state: 'pending' };
        }
      }
      const prefix = row.channel.toUpperCase();
      const endpoint = process.env[`${prefix}_PROVIDER_URL`];
      const apiKey = process.env[`${prefix}_PROVIDER_API_KEY`];
      if (!endpoint || !apiKey) { await pool.query("UPDATE notification_outbox SET state='pending' WHERE id=$1", [row.id]); return { id: row.id, state: 'pending' }; }
      try {
        const response = await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ to: row.destination, ...row.payload }), signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('Provider rejected notification');
        await pool.query("UPDATE notification_outbox SET state='sent',attempts=attempts+1,sent_at=NOW() WHERE id=$1", [row.id]);
        return { id: row.id, state: 'sent' };
      } catch {
        await pool.query("UPDATE notification_outbox SET state=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,attempts=attempts+1 WHERE id=$1", [row.id]);
        return { id: row.id, state: 'pending' };
      }
    }));
    return results;
  } finally { client.release(); }
}
