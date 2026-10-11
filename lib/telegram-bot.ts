import { createHash } from 'crypto';
import { pool } from '@/lib/db';
import { queuePaidOrderNotification, sendOrderStatusEmail } from '@/lib/notifications';
import { verify } from '@/lib/paystack';

type Button = { text: string; callback_data?: string; url?: string };
type User = { id: number; email: string; role: 'owner' | 'staff' };
type Update = {
  message?: { text?: string; chat?: { id: number; type?: string }; from?: { id: number } };
  callback_query?: { id: string; data?: string; from?: { id: number }; message?: { chat?: { id: number }; message_id?: number } };
};

const api = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN || ''}`;
async function telegram(method: string, body: Record<string, unknown>) {
  if (!process.env.TELEGRAM_BOT_TOKEN) throw new Error('Telegram bot token missing');
  const response = await fetch(`${api}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw new Error(`Telegram ${method} failed (${response.status})`);
  return data.result;
}
function keyboard(rows: Button[][]) { return { inline_keyboard: rows }; }
async function send(chatId: number, text: string, rows: Button[][] = []) {
  return telegram('sendMessage', { chat_id: chatId, text, ...(rows.length ? { reply_markup: keyboard(rows) } : {}) });
}
async function edit(chatId: number, messageId: number, text: string, rows: Button[][] = []) {
  return telegram('editMessageText', { chat_id: chatId, message_id: messageId, text, ...(rows.length ? { reply_markup: keyboard(rows) } : {}) });
}
async function answer(id: string, text = '') { return telegram('answerCallbackQuery', { callback_query_id: id, text: text.slice(0, 190) }); }
async function linkedUser(telegramId: string): Promise<User | null> {
  const result = await pool.query('SELECT id,email,role FROM admin_users WHERE telegram_user_id=$1', [telegramId]);
  return result.rows[0] || null;
}
async function getSession(id: string): Promise<{ flow: string; step: string; data: Record<string, unknown> } | null> {
  const result = await pool.query('SELECT state FROM telegram_bot_sessions WHERE telegram_user_id=$1 AND updated_at>NOW()-INTERVAL \'30 minutes\'', [id]);
  return result.rows[0]?.state || null;
}
async function setSession(id: string, state: { flow: string; step: string; data: Record<string, unknown> }) {
  await pool.query('INSERT INTO telegram_bot_sessions(telegram_user_id,state) VALUES($1,$2) ON CONFLICT(telegram_user_id) DO UPDATE SET state=EXCLUDED.state,updated_at=NOW()', [id, JSON.stringify(state)]);
}
async function clearSession(id: string) { await pool.query('DELETE FROM telegram_bot_sessions WHERE telegram_user_id=$1', [id]); }
function menu(user: User): Button[][] {
  const rows: Button[][] = [[{ text: '📦 Orders', callback_data: 'home:orders' }, { text: '📊 Report', callback_data: 'home:report' }], [{ text: '🍽 Menu', callback_data: 'home:menu' }, { text: '⚙️ Settings', callback_data: 'home:settings' }]];
  if (user.role === 'owner') rows.push([{ text: '👥 Staff', callback_data: 'home:staff' }]);
  rows.push([{ text: 'Open web dashboard', url: `${process.env.NEXT_PUBLIC_APP_URL || ''}/admin` }]);
  return rows;
}
async function showHome(chatId: number, user: User) {
  await send(chatId, `Restaurant dashboard\nSigned in as ${user.email} (${user.role}).\n\nChoose what to manage:`, menu(user));
}
const human = (value: string) => value.replaceAll('_', ' ');
const formatMoney = (value: number) => `₦${(Number(value || 0) / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function showOrders(chatId: number) {
  const result = await pool.query('SELECT id,customer_name,total_kobo,status,payment_status,created_at FROM orders ORDER BY created_at DESC LIMIT 10');
  if (!result.rowCount) return send(chatId, 'There are no orders yet.', [[{ text: '← Dashboard', callback_data: 'home' }]]);
  const rows: Button[][] = result.rows.map((order) => [{ text: `${String(order.customer_name).slice(0, 28)} · ${human(order.status)} · ${formatMoney(Number(order.total_kobo))}`, callback_data: `order:${order.id}` }]);
  rows.push([{ text: '↻ Refresh', callback_data: 'home:orders' }, { text: '← Dashboard', callback_data: 'home' }]);
  await send(chatId, 'Latest orders · tap an order to open its card:', rows);
}
async function showOrder(chatId: number, orderId: string, messageId?: number) {
  const result = await pool.query('SELECT id,customer_name,customer_email,customer_phone,delivery_address,fulfillment_type,items,total_kobo,status,payment_status,created_at FROM orders WHERE id=$1', [orderId]);
  if (!result.rowCount) return send(chatId, 'Order not found.', [[{ text: '← Orders', callback_data: 'home:orders' }]]);
  const order = result.rows[0];
  const items = (Array.isArray(order.items) ? order.items : []).map((item: { name?: string; quantity?: number; price_kobo?: number }) => `• ${item.quantity || 1} × ${item.name || 'Item'} — ${formatMoney((item.price_kobo || 0) * (item.quantity || 1))}`).join('\n');
  const text = `ORDER ${order.id.slice(0, 8).toUpperCase()}\n${order.customer_name}\n${order.customer_email}${order.customer_phone ? ` · ${order.customer_phone}` : ''}\n\n${items}\n\nTotal: ${formatMoney(Number(order.total_kobo))}\nStatus: ${human(order.status)}\nPayment: ${order.payment_status}\nFulfillment: ${order.fulfillment_type}${order.delivery_address ? `\nAddress: ${order.delivery_address}` : ''}`;
  const statuses = ['confirmed', 'preparing', 'ready', ...(order.fulfillment_type === 'pickup' ? [] : ['out_for_delivery']), 'delivered', 'completed', 'cancelled'];
  const rows: Button[][] = [];
  for (let i = 0; i < statuses.length; i += 2) rows.push(statuses.slice(i, i + 2).map((status) => ({ text: `${status === order.status ? '✓ ' : ''}${human(status)}`, callback_data: `status:${order.id}:${status}` })));
  if (order.payment_status !== 'paid') rows.push([{ text: '💳 Verify payment', callback_data: `verify:${order.id}` }]);
  rows.push([{ text: '← Orders', callback_data: 'home:orders' }, { text: 'Dashboard', callback_data: 'home' }]);
  if (messageId) await edit(chatId, messageId, text, rows); else await send(chatId, text, rows);
}
async function setOrderStatus(chatId: number, orderId: string, status: string) {
  const client = await pool.connect();
  let order: { id: string; customer_name: string; customer_email: string; items: Array<{ name?: string; quantity?: number }> } | null = null;
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT id,customer_name,customer_email,items,status FROM orders WHERE id=$1 FOR UPDATE', [orderId]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return send(chatId, 'Order not found.'); }
    if (result.rows[0].status === status) { await client.query('ROLLBACK'); return send(chatId, `Order is already ${human(status)}.`); }
    order = result.rows[0];
    await client.query('UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2', [status, orderId]);
    await client.query('INSERT INTO order_status_history(order_id,status,changed_by) VALUES($1,$2,$3)', [orderId, status, 'telegram bot']);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  if (order) {
    try {
      await sendOrderStatusEmail({ id: order.id, customerName: order.customer_name, customerEmail: order.customer_email, items: order.items || [] }, status);
      await send(chatId, `✅ Order is now ${human(status)}. Customer email sent.`);
    } catch (error) {
      await send(chatId, `Order is now ${human(status)}, but customer email failed: ${error instanceof Error ? error.message : 'Gmail send failed.'}`);
    }
    await showOrder(chatId, orderId);
  }
}
async function verifyPayment(chatId: number, orderId: string) {
  const result = await pool.query('SELECT total_kobo,payment_status,payment_reference FROM orders WHERE id=$1', [orderId]);
  if (!result.rowCount) return send(chatId, 'Order not found.');
  const order = result.rows[0];
  if (order.payment_status === 'paid') { await queuePaidOrderNotification(orderId); return send(chatId, 'Payment is already marked as paid.'); }
  if (!order.payment_reference) return send(chatId, 'This order has no Paystack payment reference.');
  const payment = await verify(order.payment_reference);
  const confirmed = payment.status === 'success' && payment.reference === order.payment_reference && payment.currency === 'NGN' && payment.amount === Number(order.total_kobo);
  if (!confirmed) return send(chatId, `Paystack reports this payment as ${payment.status || 'unconfirmed'}. The order remains unpaid.`);
  await pool.query("UPDATE orders SET payment_status='paid',status=CASE WHEN status='cancelled' THEN status ELSE 'confirmed' END WHERE id=$1 AND payment_reference=$2 AND payment_status<>'paid'", [orderId, order.payment_reference]);
  await queuePaidOrderNotification(orderId);
  await send(chatId, '✅ Paystack confirmed the payment.');
  await showOrder(chatId, orderId);
}
async function showReport(chatId: number) {
  const [stats, popular] = await Promise.all([
    pool.query("SELECT COUNT(*)::int AS orders,COUNT(*) FILTER(WHERE payment_status='paid')::int AS paid,COALESCE(SUM(total_kobo) FILTER(WHERE payment_status='paid'),0)::bigint AS revenue FROM orders WHERE created_at>=date_trunc('month',NOW())"),
    pool.query("SELECT item->>'name' AS name,SUM((item->>'quantity')::int)::int AS quantity FROM orders o CROSS JOIN LATERAL jsonb_array_elements(o.items) item WHERE o.payment_status='paid' GROUP BY item->>'name' ORDER BY quantity DESC LIMIT 5"),
  ]);
  const s = stats.rows[0];
  await send(chatId, `This month\nOrders: ${s.orders}\nPaid: ${s.paid}\nPaid revenue: ${formatMoney(Number(s.revenue))}\n\nBest sellers\n${popular.rows.map((item) => `• ${item.name}: ${item.quantity}`).join('\n') || 'No paid orders yet.'}`, [[{ text: '↻ Refresh', callback_data: 'home:report' }, { text: '← Dashboard', callback_data: 'home' }]]);
}
async function showProducts(chatId: number) {
  const result = await pool.query('SELECT id,name,price_kobo,available FROM menu_items ORDER BY id DESC LIMIT 25');
  const rows: Button[][] = result.rows.map((item) => [{ text: `${item.available ? '🟢' : '⚪'} ${String(item.name).slice(0, 32)} · ${formatMoney(item.price_kobo)}`, callback_data: `product:${item.id}` }]);
  rows.push([{ text: '＋ Add item', callback_data: 'productnew' }, { text: '← Dashboard', callback_data: 'home' }]);
  await send(chatId, 'Menu items · tap an item to manage it:', rows);
}
async function showProduct(chatId: number, id: number) {
  const result = await pool.query('SELECT id,name,description,price_kobo,available FROM menu_items WHERE id=$1', [id]);
  if (!result.rowCount) return send(chatId, 'Menu item not found.');
  const item = result.rows[0];
  await send(chatId, `${item.name}\n${item.description || 'No description'}\n${formatMoney(item.price_kobo)} · ${item.available ? 'available' : 'hidden'}`, [[{ text: item.available ? 'Hide item' : 'Publish item', callback_data: `toggleproduct:${id}` }, { text: 'Edit', callback_data: `editproduct:${id}` }], [{ text: 'Delete', callback_data: `deleteproduct:${id}` }, { text: '← Menu', callback_data: 'home:menu' }]]);
}
async function beginProduct(chatId: number, telegramId: string, mode: 'new' | 'edit', productId?: number) {
  const data: Record<string, unknown> = {};
  if (productId) {
    const result = await pool.query('SELECT id,name,description,price_kobo,category_id,image_url,available FROM menu_items WHERE id=$1', [productId]);
    if (!result.rowCount) return send(chatId, 'Menu item not found.');
    Object.assign(data, result.rows[0], { price: String(Number(result.rows[0].price_kobo) / 100) });
  }
  await setSession(telegramId, { flow: 'product', step: 'name', data: { ...data, mode } });
  await send(chatId, mode === 'new' ? 'Send the menu item name.' : `Send a new name for “${data.name}”.`);
}
async function promptCategory(chatId: number, telegramId: string, state: { flow: string; step: string; data: Record<string, unknown> }) {
  const result = await pool.query('SELECT id,name FROM categories ORDER BY name');
  await setSession(telegramId, { ...state, step: 'category' });
  await send(chatId, 'Choose a category:', result.rows.map((row) => [{ text: row.name, callback_data: `category:${row.id}` }]));
}
async function handleText(chatId: number, telegramId: string, text: string, user: User) {
  const state = await getSession(telegramId);
  if (!state) return send(chatId, 'Use the dashboard buttons below. Send /dashboard to open the menu.', menu(user));
  if (state.flow === 'product') {
    if (state.step === 'name') {
      if (!text.trim() || text.length > 120) return send(chatId, 'Enter a name from 1 to 120 characters.');
      state.data.name = text.trim(); state.step = 'description'; await setSession(telegramId, state); return send(chatId, 'Send a short description, or type - to leave it blank.');
    }
    if (state.step === 'description') {
      if (text.length > 500) return send(chatId, 'Keep the description under 500 characters.');
      state.data.description = text === '-' ? '' : text.trim(); state.step = 'price'; await setSession(telegramId, state); return send(chatId, 'Send the price in naira (example: 2500).');
    }
    if (state.step === 'price') {
      const price = Number(text.replaceAll(',', ''));
      if (!Number.isFinite(price) || price <= 0 || price > 21474836 || !Number.isInteger(price * 100)) return send(chatId, 'Enter a valid price in naira, up to 2 decimal places.');
      state.data.price_kobo = Math.round(price * 100);
      return promptCategory(chatId, telegramId, state);
    }
    if (state.step === 'image') {
      if (text !== '-' && (text.length > 2048 || !/^https:\/\//i.test(text))) return send(chatId, 'Send a valid HTTPS image URL, or type - to keep the current image.');
      if (text !== '-') state.data.image_url = text.trim();
      const d = state.data;
      if (d.mode === 'edit') await pool.query('UPDATE menu_items SET name=$1,description=$2,price_kobo=$3,category_id=$4,image_url=$5 WHERE id=$6', [d.name, d.description, d.price_kobo, d.category_id, d.image_url || '', d.id]);
      else await pool.query('INSERT INTO menu_items(name,description,price_kobo,category_id,image_url,available) VALUES($1,$2,$3,$4,$5,$6)', [d.name, d.description, d.price_kobo, d.category_id, d.image_url || '', true]);
      await clearSession(telegramId);
      return send(chatId, d.mode === 'edit' ? '✅ Menu item updated.' : '✅ Menu item added.', [[{ text: '← Menu', callback_data: 'home:menu' }]]);
    }
  }
  if (state.flow === 'setting') {
    const key = state.data.key as string;
    if (key === 'deliveryFeeKobo') {
      const fee = Number(text.replaceAll(',', ''));
      if (!Number.isFinite(fee) || fee < 0 || fee > 1000000 || !Number.isInteger(fee * 100)) return send(chatId, 'Enter a valid delivery fee in naira.');
      const current = await pool.query('SELECT settings FROM restaurant_settings WHERE id=1');
      const settings = { ...(current.rows[0]?.settings || {}), deliveryFeeKobo: Math.round(fee * 100) };
      await pool.query('INSERT INTO restaurant_settings(id,settings,updated_at) VALUES(1,$1,NOW()) ON CONFLICT(id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW()', [JSON.stringify(settings)]);
      await clearSession(telegramId); return send(chatId, `✅ Delivery fee set to ${formatMoney(settings.deliveryFeeKobo)}.`, [[{ text: '← Settings', callback_data: 'home:settings' }]]);
    }
    if (text.length > (key === 'openingHours' ? 1000 : 500)) return send(chatId, 'That value is too long. Try again.');
    if (key === 'email' && text && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return send(chatId, 'Enter a valid email address.');
    if (key === 'logoUrl' && text && !/^https:\/\//i.test(text)) return send(chatId, 'The logo URL must start with https://.');
    const current = await pool.query('SELECT settings FROM restaurant_settings WHERE id=1');
    const settings = { ...(current.rows[0]?.settings || {}), [key]: text.trim() };
    await pool.query('INSERT INTO restaurant_settings(id,settings,updated_at) VALUES(1,$1,NOW()) ON CONFLICT(id) DO UPDATE SET settings=EXCLUDED.settings,updated_at=NOW()', [JSON.stringify(settings)]);
    await clearSession(telegramId);
    return send(chatId, `✅ ${key} updated.`, [[{ text: '← Settings', callback_data: 'home:settings' }]]);
  }
  return send(chatId, 'I could not match that reply to an action. Send /dashboard to start again.', menu(user));
}
async function showSettings(chatId: number) {
  const result = await pool.query('SELECT settings FROM restaurant_settings WHERE id=1');
  const s = result.rows[0]?.settings || {};
  await send(chatId, `${s.name || 'Restaurant'}\nDelivery: ${s.deliveryEnabled ? 'on' : 'off'} · Pickup: ${s.pickupEnabled ? 'on' : 'off'}\nDelivery fee: ${formatMoney(Number(s.deliveryFeeKobo || 0))}\nContact: ${s.phone || 'not set'} · ${s.email || 'not set'}\nAddress: ${s.address || 'not set'}`, [[{ text: `Delivery ${s.deliveryEnabled ? '✓' : 'off'}`, callback_data: 'setting:deliveryEnabled' }, { text: `Pickup ${s.pickupEnabled ? '✓' : 'off'}`, callback_data: 'setting:pickupEnabled' }], [{ text: 'Edit name', callback_data: 'settingtext:name' }, { text: 'Edit phone', callback_data: 'settingtext:phone' }], [{ text: 'Edit email', callback_data: 'settingtext:email' }, { text: 'Edit address', callback_data: 'settingtext:address' }], [{ text: 'Delivery fee', callback_data: 'settingtext:deliveryFeeKobo' }, { text: 'Opening hours', callback_data: 'settingtext:openingHours' }], [{ text: 'Logo URL', callback_data: 'settingtext:logoUrl' }, { text: 'Receipt footer', callback_data: 'settingtext:receiptFooter' }], [{ text: '← Dashboard', callback_data: 'home' }]]);
}
async function showStaff(chatId: number, user: User) {
  if (user.role !== 'owner') return send(chatId, 'Only the owner can manage staff.');
  const result = await pool.query('SELECT id,email,role FROM admin_users ORDER BY created_at,id');
  const rows: Button[][] = result.rows.filter((staff) => staff.email !== user.email).map((staff) => [{ text: `Remove ${staff.email.slice(0, 32)} (${staff.role})`, callback_data: `staffremove:${staff.id}` }]);
  rows.push([{ text: '← Dashboard', callback_data: 'home' }]);
  await send(chatId, `Staff accounts (${result.rowCount}):\n${result.rows.map((staff) => `• ${staff.email} — ${staff.role}`).join('\n')}`, rows);
}
async function callback(chatId: number, messageId: number, telegramId: string, user: User, data: string) {
  if (data === 'home') return showHome(chatId, user);
  if (data === 'home:orders') return showOrders(chatId);
  if (data === 'home:report') return showReport(chatId);
  if (data === 'home:menu') return showProducts(chatId);
  if (data === 'home:settings') return showSettings(chatId);
  if (data === 'home:staff') return showStaff(chatId, user);
  if (data.startsWith('order:')) return showOrder(chatId, data.slice(6), messageId);
  if (data.startsWith('status:')) {
    const [, id, status] = data.split(':');
    if (!/^[0-9a-f-]{36}$/i.test(id) || !['confirmed','preparing','ready','out_for_delivery','delivered','completed','cancelled'].includes(status)) return;
    const order = await pool.query('SELECT fulfillment_type FROM orders WHERE id=$1', [id]);
    if (order.rows[0]?.fulfillment_type === 'pickup' && status === 'out_for_delivery') return send(chatId, 'Pickup orders cannot be marked out for delivery.');
    return setOrderStatus(chatId, id, status);
  }
  if (data.startsWith('verify:')) return verifyPayment(chatId, data.slice(7));
  if (data.startsWith('product:')) return showProduct(chatId, Number(data.slice(8)));
  if (data.startsWith('toggleproduct:')) {
    const id = Number(data.slice(14)); await pool.query('UPDATE menu_items SET available=NOT available WHERE id=$1', [id]); return showProduct(chatId, id);
  }
  if (data.startsWith('editproduct:')) return beginProduct(chatId, telegramId, 'edit', Number(data.slice(12)));
  if (data === 'productnew') return beginProduct(chatId, telegramId, 'new');
  if (data.startsWith('deleteproduct:')) {
    const id = Number(data.slice(14)); return send(chatId, 'Delete this menu item permanently?', [[{ text: 'Confirm delete', callback_data: `confirmdelete:${id}` }, { text: 'Cancel', callback_data: `product:${id}` }]]);
  }
  if (data.startsWith('confirmdelete:')) { const id = Number(data.slice(14)); await pool.query('DELETE FROM menu_items WHERE id=$1', [id]); return send(chatId, 'Menu item deleted.', [[{ text: '← Menu', callback_data: 'home:menu' }]]); }
  if (data.startsWith('category:')) {
    const categoryId = Number(data.slice(9));
    const state = await getSession(telegramId);
    if (!state || state.flow !== 'product' || state.step !== 'category') return send(chatId, 'That menu form expired. Start again from Menu.');
    state.data.category_id = categoryId;
    state.step = 'image'; await setSession(telegramId, state);
    return send(chatId, state.data.mode === 'edit' ? 'Send an HTTPS image URL, or type - to keep the existing image.' : 'Send an HTTPS image URL, or type - for no image.');
  }
  if (data === 'setting:deliveryEnabled' || data === 'setting:pickupEnabled') {
    const key = data.slice(8); const result = await pool.query('SELECT settings FROM restaurant_settings WHERE id=1'); const settings = result.rows[0]?.settings || {};
    settings[key] = !settings[key]; await pool.query('UPDATE restaurant_settings SET settings=$1,updated_at=NOW() WHERE id=1', [JSON.stringify(settings)]); return showSettings(chatId);
  }
  if (data.startsWith('settingtext:')) {
    const key = data.slice(12);
    if (!['name','phone','email','address','logoUrl','deliveryFeeKobo','openingHours','receiptFooter'].includes(key)) return;
    await setSession(telegramId, { flow: 'setting', step: 'text', data: { key } }); return send(chatId, `Send the new restaurant ${key}.`);
  }
  if (data.startsWith('staffremove:')) {
    if (user.role !== 'owner') return send(chatId, 'Only the owner can manage staff.');
    const id = Number(data.slice(12)); const target = await pool.query('SELECT email,role FROM admin_users WHERE id=$1', [id]);
    if (!target.rowCount) return send(chatId, 'Staff account not found.');
    if (target.rows[0].email === user.email) return send(chatId, 'You cannot remove your own account.');
    if (target.rows[0].role === 'owner') { const count = await pool.query("SELECT COUNT(*)::int AS n FROM admin_users WHERE role='owner'"); if (count.rows[0].n <= 1) return send(chatId, 'The last owner account cannot be removed.'); }
    await pool.query('DELETE FROM admin_users WHERE id=$1', [id]); return send(chatId, `Removed ${target.rows[0].email}.`, [[{ text: '← Staff', callback_data: 'home:staff' }]]);
  }
}

export async function handleTelegramUpdate(update: Update) {
  const message = update.message;
  const query = update.callback_query;
  if (message) {
    if (!message.from || message.chat?.type !== 'private' || message.chat.id !== message.from.id) return;
    const chatId = message.chat.id; const telegramId = String(message.from.id); const text = (message.text || '').trim();
    if (text.startsWith('/link')) {
      const code = text.split(/\s+/)[1] || '';
      if (!/^\d{8}$/.test(code)) return send(chatId, 'Open the web dashboard, generate a Telegram link code, then send /link followed by that 8 digit code.');
      const hash = createHash('sha256').update(code).digest('hex');
      try {
        const linked = await pool.query('UPDATE admin_users SET telegram_user_id=$1,telegram_link_code_hash=NULL,telegram_link_expires_at=NULL WHERE telegram_link_code_hash=$2 AND telegram_link_expires_at>NOW() RETURNING email,role', [telegramId, hash]);
        if (!linked.rowCount) return send(chatId, 'That code is invalid or expired. Generate a fresh code from the web dashboard.');
        await pool.query('DELETE FROM telegram_bot_sessions WHERE telegram_user_id=$1', [telegramId]);
        return send(chatId, `Telegram linked to ${linked.rows[0].email}.`, [[{ text: 'Open dashboard', callback_data: 'home' }]]);
      } catch { return send(chatId, 'This Telegram account is already linked to another admin.'); }
    }
    const user = await linkedUser(telegramId);
    if (!user) return send(chatId, 'This Telegram account is not linked yet. Sign in to the web dashboard, choose Link Telegram, then send /link CODE here.');
    if (text === '/start' || text === '/dashboard' || text === '/menu') return showHome(chatId, user);
    if (text === '/help') return send(chatId, 'Use the buttons for orders, reports, menu and settings. To link another admin account, generate a fresh link code from the web dashboard.');
    return handleText(chatId, telegramId, text, user);
  }
  if (query) {
    await answer(query.id);
    const telegramId = query.from ? String(query.from.id) : '';
    const chatId = query.message?.chat?.id; const messageId = query.message?.message_id;
    if (!telegramId || !chatId || !messageId) return;
    if (query.message?.chat && query.message.chat.id !== query.from?.id) return;
    const user = await linkedUser(telegramId);
    if (!user) return send(chatId, 'This Telegram account is not linked. Sign in on the web dashboard and use Link Telegram first.');
    await callback(chatId, messageId, telegramId, user, query.data || '');
  }
}
