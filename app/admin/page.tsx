'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import StaffMessages from '@/components/staff-messages';
import ThemeToggle from '@/components/theme-toggle';

type Product = { id: number; category_id: number | null; name: string; description: string; price_kobo: number; image_url: string; available: boolean; stock_quantity: number | null };
type Category = { id: number; name: string };
type OrderItem = { id: number; name: string; quantity: number; price_kobo: number; special_request?: string };
type Order = { id: string; customer_name: string; customer_email: string; customer_phone: string; delivery_address: string; fulfillment_type: 'delivery' | 'pickup'; delivery_fee_kobo: number; items: OrderItem[]; total_kobo: number; status: string; payment_status: string; created_at: string };
type ProductForm = { name: string; description: string; price: string; categoryId: string; imageUrl: string; available: boolean; stockQuantity: string };
type StaffUser = { id: number; email: string; role: 'owner' | 'staff' | 'kitchen'; created_at: string };
type Reservation = { id: number; customer_name: string; customer_email: string; customer_phone: string; reservation_date: string; reservation_time: string; party_size: number; notes: string; status: string; reservation_fee_kobo: number; payment_status: string; created_at: string };

const emptyForm: ProductForm = { name: '', description: '', price: '', categoryId: '', imageUrl: '', available: true, stockQuantity: '0' };
const orderStatuses = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed', 'cancelled'];
const formatPrice = (priceKobo: number) => `₦${(priceKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (date: string) => new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' }).format(new Date(date));
const mapUrlForAddress = (address: string) => {
  const pin = address.match(/https:\/\/maps\.google\.com\/\?q=-?\d+(?:\.\d+)?,-?\d+(?:\.\d+)?/i)?.[0];
  return pin || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
};

async function readResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = response.status === 413
      ? 'Upload too large (HTTP 413). The server rejected the image size; try a smaller photo.'
      : `The request failed (HTTP ${response.status}).`;
    throw new Error(data.error || detail);
  }
  return data as T;
}

async function prepareMenuPhoto(file: File): Promise<File> {
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!supportedTypes.includes(file.type)) throw new Error('Use a JPG, PNG, or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
  const targetBytes = 800 * 1024;
  if (file.size <= targetBytes) return file;

  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error('This image could not be opened by the browser. Save it as JPG, PNG, or WebP and try again.'); }
  try {
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this image.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    let quality = 0.84;
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 7; attempt += 1) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
      if (blob && blob.size <= targetBytes) break;
      if (attempt % 2 === 1) {
        canvas.width = Math.max(1, Math.round(canvas.width * 0.8));
        canvas.height = Math.max(1, Math.round(canvas.height * 0.8));
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      } else quality -= 0.1;
    }
    if (!blob || blob.size > targetBytes) throw new Error('This image could not be reduced enough. Choose a smaller photo.');
    const safeName = file.name.replace(/\.[^.]+$/, '') || 'dish-photo';
    return new File([blob], `${safeName}.webp`, { type: 'image/webp', lastModified: Date.now() });
  } finally { bitmap.close(); }
}

export default function Admin() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [editing, setEditing] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verifyingOrder, setVerifyingOrder] = useState<string | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetRequestMessage, setResetRequestMessage] = useState('');
  const [resetRequestBusy, setResetRequestBusy] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('');
  const [dashboardStats, setDashboardStats] = useState<{orders:number;paid_orders:number;revenue_kobo:number}>({orders:0,paid_orders:0,revenue_kobo:0});
  const [popularItems, setPopularItems] = useState<{name:string;quantity:number}[]>([]);
  const [settings, setSettings] = useState({name:'Restaurant',address:'',phone:'',email:'',logoUrl:'',openingHours:'',receiptFooter:'Thank you for your order.',deliveryEnabled:true,pickupEnabled:true,deliveryFeeKobo:0,reservationFree:true,reservationFeeKobo:0});
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffPassword, setNewStaffPassword] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'staff'|'owner'|'kitchen'>('staff');
  const [canManageStaff, setCanManageStaff] = useState(false);
  const [telegramLinkCode, setTelegramLinkCode] = useState('');
  const [telegramLinkCopied, setTelegramLinkCopied] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const [restaurantLocationBusy, setRestaurantLocationBusy] = useState(false);
  const [restaurantLocationMessage, setRestaurantLocationMessage] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoadingDashboard(true);
    setError('');
    try {
      const [ordersData, productsData, menuData, settingsData, reservationData] = await Promise.all([
        fetch(`/api/admin/orders?q=${encodeURIComponent(orderSearch)}&status=${encodeURIComponent(orderFilter)}&fulfillment=${encodeURIComponent(fulfillmentFilter)}`, { cache: 'no-store' }).then(readResponse<{orders:Order[];stats:typeof dashboardStats;popularItems:typeof popularItems}>),
        fetch('/api/admin/products', { cache: 'no-store' }).then(readResponse<Product[]>),
        fetch('/api/menu', { cache: 'no-store' }).then(readResponse<{ categories?: Category[] }>),
        fetch('/api/admin/settings', {cache:'no-store'}).then(readResponse<typeof settings>),
        fetch('/api/admin/reservations', { cache: 'no-store' }).then(readResponse<Reservation[]>),
      ]);
      setOrders(ordersData.orders); setDashboardStats(ordersData.stats); setPopularItems(ordersData.popularItems); setSettings((current) => ({...current,...settingsData}));
      setProducts(productsData);
      setCategories(menuData.categories || []);
      setReservations(reservationData);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to load the dashboard.');
    } finally {
      setLoadingDashboard(false);
    }
  }, [orderSearch, orderFilter, fulfillmentFilter]);

  useEffect(() => {
    let active = true;
    fetch('/api/admin/auth', { cache: 'no-store' })
      .then(readResponse<{ authenticated: boolean; role?: string }>)
      .then((data) => {
        if (!active) return;
        if (data.authenticated && data.role === 'kitchen') { window.location.replace('/kitchen'); return; }
        setAuthenticated(data.authenticated);
        if (data.authenticated) void loadDashboard();
      })
      .catch(() => { if (active) setAuthenticated(false); });
    return () => { active = false; };
  }, [loadDashboard]);

  useEffect(() => {
    if (!authenticated) return;
    fetch('/api/admin/users', { cache: 'no-store' }).then(readResponse<StaffUser[]>).then((users) => { setStaff(users); setCanManageStaff(true); }).catch(() => { setStaff([]); setCanManageStaff(false); });
  }, [authenticated]);

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await readResponse(await fetch('/api/admin/password', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({currentPassword,newPassword}) }));
      setCurrentPassword(''); setNewPassword(''); setMessage('Your password has been changed.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to change password.'); }
    finally { setBusy(false); }
  }

  async function addStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      const user = await readResponse<StaffUser>(await fetch('/api/admin/users', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:newStaffEmail,password:newStaffPassword,role:newStaffRole}) }));
      setStaff((current) => [...current,user]); setNewStaffEmail(''); setNewStaffPassword(''); setNewStaffRole('staff'); setMessage('Staff account created.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create account.'); }
    finally { setBusy(false); }
  }

  async function removeStaff(id: number) {
    if (!window.confirm('Remove this staff account?')) return;
    try { await readResponse(await fetch(`/api/admin/users?id=${id}`, { method:'DELETE' })); setStaff((current)=>current.filter((user)=>user.id!==id)); setMessage('Staff account removed.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to remove account.'); }
  }

  useEffect(() => {
    if (!authenticated) return;
    const refresh = () => { if (document.visibilityState === 'visible') void loadDashboard(); };
    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [authenticated, loadDashboard]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const loginResult = await readResponse<{ authenticated: boolean; role: string }>(await fetch('/api/admin/auth', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      }));
      setLoginPassword('');
      if (loginResult.role === 'kitchen') { window.location.assign('/kitchen'); return; }
      setAuthenticated(true);
      await loadDashboard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function requestPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResetRequestBusy(true); setResetRequestMessage('');
    try {
      const result = await readResponse<{ message: string }>(await fetch('/api/admin/password-reset/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: resetEmail.trim() }),
      }));
      setResetRequestMessage(result.message);
    } catch {
      setResetRequestMessage('We could not send a reset request right now. Please try again shortly.');
    } finally { setResetRequestBusy(false); }
  }

  async function logout() {
    setBusy(true);
    try {
      await fetch('/api/admin/auth', { method: 'DELETE' });
      setAuthenticated(false);
      setOrders([]);
      setProducts([]);
      setReservations([]);
      setMessage('You have signed out.');
    } catch {
      setError('Could not sign out. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function updateOrder(id: string, status: string) {
    setError('');
    try {
      const updated = await readResponse<Order & { emailSent?: boolean | null; emailError?: string }>(await fetch(`/api/admin/orders/${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      }));
      setOrders((current) => current.map((order) => order.id === id ? updated : order));
      setMessage(updated.emailSent === true ? 'Order status updated and email sent.' : updated.emailSent === false ? `Order status updated, but email failed: ${updated.emailError || 'check Gmail settings'}` : 'Order status updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update order.');
    }
  }

  async function updateReservation(id: number, status: string) {
    setError('');
    try {
      const updated = await readResponse<{ id: number; status: string }>(await fetch('/api/admin/reservations', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
      }));
      setReservations((current) => current.map((reservation) => reservation.id === id ? { ...reservation, status: updated.status } : reservation));
      setMessage('Reservation status updated.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update reservation.');
    }
  }

  async function createTelegramLink() {
    setError(''); setTelegramLinkCode(''); setTelegramLinkCopied(false);
    try {
      const result = await readResponse<{ code: string }>(await fetch('/api/admin/telegram-link', { method: 'POST' }));
      setTelegramLinkCode(result.code);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create a Telegram link code.'); }
  }

  async function copyTelegramLinkCommand() {
    if (!telegramLinkCode) return;
    try { await navigator.clipboard.writeText(`/link ${telegramLinkCode}`); setTelegramLinkCopied(true); }
    catch { setError('Could not copy the Telegram command. You can copy it manually.'); }
  }

  async function copyOrderLocation(address: string) {
    try {
      await navigator.clipboard.writeText(mapUrlForAddress(address));
      setError(''); setMessage('Delivery map link copied.');
    } catch {
      setError('Could not copy the map link. Use Open map instead.');
    }
  }

  function shareRestaurantLocation() {
    setError('');
    setRestaurantLocationMessage('');
    if (!navigator.geolocation) { setError('Location sharing is unavailable in this browser. Enter the restaurant address manually.'); return; }
    setRestaurantLocationBusy(true);
    navigator.geolocation.getCurrentPosition((position) => {
      const latitude = position.coords.latitude.toFixed(6);
      const longitude = position.coords.longitude.toFixed(6);
      const pin = `Map pin: ${latitude}, ${longitude} (https://maps.google.com/?q=${latitude},${longitude})`;
      const nextAddress = settings.address.trim() ? `${settings.address.trim()}\n${pin}` : pin;
      if (nextAddress.length > 500) setError('The restaurant address is too long to add a map pin. Shorten it and try again.');
      else { setSettings((current) => ({ ...current, address: nextAddress })); setRestaurantLocationMessage('Location added to the address. Save restaurant settings to publish it.'); setMessage('Restaurant location added. Save the settings to publish it.'); }
      setRestaurantLocationBusy(false);
    }, (cause) => {
      const text = cause.code === 1 ? 'Location permission is off. Allow it in your browser settings, or enter the address manually.' : cause.code === 3 ? 'Location request timed out. Try again or enter the address manually.' : 'We could not read your location. Check device location services or enter the address manually.';
      setRestaurantLocationMessage(text);
      setError(text);
      setRestaurantLocationBusy(false);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  async function verifyOrderPayment(id: string) {
    setError('');
    setVerifyingOrder(id);
    try {
      const result = await readResponse<{ confirmed: boolean; order?: Order; paymentStatus?: string }>(await fetch(`/api/admin/orders/${encodeURIComponent(id)}/payment`, { method: 'POST' }));
      if (result.confirmed && result.order) {
        setOrders((current) => current.map((order) => order.id === id ? result.order! : order));
        setMessage('Payment verified with Paystack and order confirmed.');
      } else {
        setMessage(`Paystack reports this payment as ${result.paymentStatus || 'not confirmed'}; the order remains unpaid.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to verify payment.');
    } finally {
      setVerifyingOrder(null);
    }
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try { const saved = await readResponse<typeof settings>(await fetch('/api/admin/settings', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)})); setSettings(saved); setMessage('Restaurant settings saved.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save restaurant settings.'); }
    finally { setBusy(false); }
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('Saving product…');
    setError('');
    const wasEditing = editing !== null;
    try {
      const endpoint = wasEditing ? `/api/admin/products/${editing}` : '/api/admin/products';
      const saved = await readResponse<Product>(await fetch(endpoint, {
        method: wasEditing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      }));
      setProducts((current) => wasEditing ? current.map((product) => product.id === saved.id ? saved : product) : [saved, ...current]);
      setForm(emptyForm);
      setEditing(null);
      setMessage(wasEditing ? 'Product changes saved.' : 'Product published to the menu.');
    } catch (cause) {
      setMessage('');
      setError(cause instanceof Error ? cause.message : 'Unable to save product.');
    } finally {
      setBusy(false);
    }
  }

  async function uploadProductPhoto(file?: File) {
    if (!file) return;
    setError(''); setMessage(''); setUploadingPhoto(true);
    try {
      const payload = await prepareMenuPhoto(file);
      const data = new FormData();
      data.append('file', payload);
      const response = await fetch('/api/admin/images', { method: 'POST', body: data });
      const result = await readResponse<{ imageUrl: string }>(response);
      setForm((current) => ({ ...current, imageUrl: result.imageUrl }));
      setMessage(`Photo uploaded${payload.size < file.size ? ' and optimized' : ''}. Preview it below, then save the dish.`);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : 'Unknown upload error.';
      setError(detail === 'Failed to fetch' ? 'Upload could not reach the server. Check the connection and try again.' : detail);
    } finally { setUploadingPhoto(false); }
  }

  function editProduct(product: Product) {
    setEditing(product.id);
    setForm({ name: product.name, description: product.description || '', price: String(product.price_kobo / 100), categoryId: product.category_id ? String(product.category_id) : '', imageUrl: product.image_url || '', available: product.available, stockQuantity: product.stock_quantity === null ? '' : String(product.stock_quantity) });
    document.getElementById('product-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function removeProduct(id: number) {
    if (!window.confirm('Remove this product from the menu?')) return;
    setError('');
    try {
      await readResponse(await fetch(`/api/admin/products/${id}`, { method: 'DELETE' }));
      setProducts((current) => current.filter((product) => product.id !== id));
      setMessage('Product removed from the menu.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove product.');
    }
  }

  if (authenticated === null) return <main className="wrap admin-shell"><div className="admin-loading"><span className="loading-dot" /> Checking secure staff access…</div></main>;

  if (!authenticated) return (
    <main className="admin-login-shell">
      <div className="admin-login-theme"><ThemeToggle /></div>
      <section className="admin-login-card">
        <Link href="/" className="brand"><span className="brand-mark">R</span> Restaurant</Link>
        <p className="eyebrow">STAFF ACCESS</p>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to manage the menu and customer orders.</p>
        <form onSubmit={login} className="admin-login-form">
          <label className="field"><span>Staff email</span><input autoComplete="username" type="email" value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} required /></label>
          <label className="field"><span>Password</span><input autoComplete="current-password" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} required /></label>
          {error && <p className="admin-error" role="alert">{error}</p>}
          <button className="btn admin-login-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'} <span aria-hidden="true">→</span></button>
        </form>
        <button className="login-forgot-link" type="button" onClick={() => { setResetEmail(loginEmail); setResetRequestMessage(''); setForgotPasswordOpen((open) => !open); }}>
          {forgotPasswordOpen ? 'Close password reset' : 'Forgot password?'}
        </button>
        {forgotPasswordOpen && <form onSubmit={requestPasswordReset} className="forgot-password-form">
          <p className="muted">Enter your staff email and we’ll send a secure reset link if it belongs to an account.</p>
          <label className="field"><span>Staff email</span><input type="email" autoComplete="email" value={resetEmail} onChange={(event) => setResetEmail(event.target.value)} required maxLength={254} /></label>
          {resetRequestMessage && <p className="admin-success" role="status">{resetRequestMessage}</p>}
          <button className="btn admin-login-submit" type="submit" disabled={resetRequestBusy}>{resetRequestBusy ? 'Sending…' : 'Email reset link'}</button>
        </form>}
        <Link className="login-back-link" href="/">← Back to storefront</Link>
      </section>
    </main>
  );

  const publishedProducts = products.filter((product) => product.available && (product.stock_quantity === null || product.stock_quantity > 0)).length;

  return (
    <main className="wrap admin-shell">
      <header className="admin-header">
        <Link href="/" className="brand"><span className="brand-mark">R</span> Restaurant <span className="admin-label">STAFF</span></Link>
        <div className="admin-header-actions"><ThemeToggle /><span className="admin-session-label"><span /> Secure staff session</span><button className="plain-btn" onClick={logout} disabled={busy}>Sign out</button></div>
      </header>

      <section className="admin-welcome"><div><p className="eyebrow">YOUR RESTAURANT, AT A GLANCE</p><h1>Dashboard</h1><p className="muted">Manage your menu and keep every order moving.</p></div><button className="admin-refresh" onClick={loadDashboard} disabled={loadingDashboard}>{loadingDashboard ? 'Refreshing…' : '↻ Refresh'}</button></section>

      {error && <p className="admin-error admin-banner" role="alert">{error}</p>}
      {message && <p className="admin-success admin-banner" role="status">{message}</p>}

      <StaffMessages orders={orders} />

      <section className="admin-metrics" aria-label="Restaurant summary">
        <article className="metric-card"><span className="metric-icon">↗</span><span className="metric-label">Orders this month</span><strong>{dashboardStats.orders}</strong><small>{dashboardStats.paid_orders} payments received</small></article>
        <article className="metric-card"><span className="metric-icon">₦</span><span className="metric-label">Paid revenue this month</span><strong>{formatPrice(Number(dashboardStats.revenue_kobo))}</strong><small>Confirmed payments only</small></article>
        <article className="metric-card"><span className="metric-icon">▦</span><span className="metric-label">Published dishes</span><strong>{publishedProducts}</strong><small>{categories.length} menu categories</small></article>
      </section>

      <section className="admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">TELEGRAM BOT</p><h2>Link your Telegram account</h2><p className="muted">Generate a one time code, then send the command below to your bot in a private chat.</p></div><button className="btn" type="button" onClick={() => void createTelegramLink()}>Generate link code</button></div>{telegramLinkCode && <div className="admin-success" role="status"><span>Command: <code>/link {telegramLinkCode}</code> · expires in 10 minutes</span><button className="text-action" type="button" onClick={() => void copyTelegramLinkCommand()}>{telegramLinkCopied ? 'Copied' : 'Copy command'}</button></div>}</section>

      <section className="admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">ACCOUNT SECURITY</p><h2>Change your password</h2><p className="muted">Use at least 12 characters.</p></div></div><form className="product-form" onSubmit={changePassword}><label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} required /></label><label className="field"><span>New password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} required /></label><div><button className="btn" disabled={busy}>Change password</button></div></form></section>
      {canManageStaff && <section className="admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">OWNER TOOLS</p><h2>Staff accounts</h2><p className="muted">Kitchen accounts open a focused preparation screen.</p></div></div><form className="product-form" onSubmit={addStaff}><label className="field"><span>Email</span><input type="email" autoComplete="off" value={newStaffEmail} onChange={(e)=>setNewStaffEmail(e.target.value)} required maxLength={254}/></label><label className="field"><span>Temporary password</span><input type="password" autoComplete="new-password" minLength={12} maxLength={256} value={newStaffPassword} onChange={(e)=>setNewStaffPassword(e.target.value)} required /></label><label className="field"><span>Access level</span><select value={newStaffRole} onChange={(e)=>setNewStaffRole(e.target.value as 'staff'|'owner'|'kitchen')}><option value="staff">Staff</option><option value="kitchen">Kitchen</option><option value="owner">Owner</option></select></label><div><button className="btn" disabled={busy}>Create account</button></div></form><div className="product-list">{staff.map((user)=><article className="product-row staff-row" key={user.id}><div className="product-row-copy"><h3>{user.email}</h3><p>{user.role} account</p></div><button className="text-action danger staff-remove-button" type="button" onClick={()=>void removeStaff(user.id)}>Remove</button></article>)}</div></section>}

      <section className="admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">BUSINESS DETAILS</p><h2>Restaurant and receipt settings</h2></div></div><form className="product-form" onSubmit={saveSettings}>
        {([['name','Restaurant name'],['logoUrl','Logo URL (HTTPS)'],['phone','Contact phone'],['email','Contact email'],['address','Restaurant address'],['openingHours','Opening hours'],['receiptFooter','Receipt footer']] as const).map(([key,title])=>key==='address'?<div className="field location-field" key={key}><label htmlFor="restaurant-address">{title}</label><textarea id="restaurant-address" value={settings.address} onChange={(e)=>setSettings({...settings,address:e.target.value})} maxLength={500} rows={3}/><button className="location-button" type="button" onClick={shareRestaurantLocation} disabled={restaurantLocationBusy}>{restaurantLocationBusy?'Getting location…':'⌖ Add current location'}</button>{restaurantLocationMessage && <small className="location-message" role="status" aria-live="polite">{restaurantLocationMessage}</small>}</div>:<label className="field" key={key}><span>{title}</span><input value={settings[key]} onChange={(e)=>setSettings({...settings,[key]:e.target.value})} maxLength={500}/></label>)}
        <label className="field"><span>Delivery fee (₦)</span><input type="number" min="0" step="0.01" value={settings.deliveryFeeKobo/100} onChange={(e)=>setSettings({...settings,deliveryFeeKobo:Math.round(Number(e.target.value)*100)})}/></label>
        <label className="availability-toggle"><input type="checkbox" checked={settings.reservationFree} onChange={(e)=>setSettings({...settings,reservationFree:e.target.checked})}/><span>Table reservations are free</span></label>
        <label className="field"><span>Reservation fee per booking (₦)</span><input type="number" min="0" step="0.01" value={settings.reservationFeeKobo/100} disabled={settings.reservationFree} onChange={(e)=>setSettings({...settings,reservationFeeKobo:Math.round(Number(e.target.value)*100)})}/><small>Customers pay this fee securely through Paystack when they book.</small></label>
        <label className="availability-toggle"><input type="checkbox" checked={settings.deliveryEnabled} onChange={(e)=>setSettings({...settings,deliveryEnabled:e.target.checked})}/><span>Enable delivery</span></label><label className="availability-toggle"><input type="checkbox" checked={settings.pickupEnabled} onChange={(e)=>setSettings({...settings,pickupEnabled:e.target.checked})}/><span>Enable pickup</span></label><div><button className="btn" disabled={busy}>Save restaurant settings</button></div>
      </form></section>
      {popularItems.length>0 && <section className="admin-panel"><div className="admin-panel-heading"><div><p className="eyebrow">CUSTOMER FAVOURITES</p><h2>Popular items</h2></div></div><p>{popularItems.map((item)=>`${item.name} (${item.quantity})`).join(' · ')}</p></section>}

      <section className="admin-panel" aria-labelledby="reservations-title">
        <div className="admin-panel-heading list-heading"><div><p className="eyebrow">TABLE BOOKINGS</p><h2 id="reservations-title">Reservations <span className="count-pill">{reservations.length}</span></h2><p className="muted">Review booking requests and confirm them with customers.</p></div></div>
        {reservations.length === 0 ? <div className="admin-empty"><strong>No table requests yet</strong><p>Customer reservation requests will appear here.</p></div> : <div className="order-list">{reservations.map((reservation) => (
          <article className="admin-order reservation-row" key={reservation.id}>
            <div className="order-topline"><div><span className="order-id">RESERVATION · #{reservation.id}</span><h3>{reservation.customer_name} · {reservation.party_size} {reservation.party_size === 1 ? 'guest' : 'guests'}</h3><p className="muted">{reservation.customer_email} · {reservation.customer_phone}</p></div><span className={`status-pill ${reservation.status === 'confirmed' || reservation.status === 'completed' ? 'available' : 'hidden'}`}>{reservation.status}</span></div>
            <div className="reservation-details"><strong>{reservation.reservation_date.slice(0, 10)} · {reservation.reservation_time.slice(0, 5)}</strong><p className="reservation-fee">{reservation.reservation_fee_kobo > 0 ? `Fee: ${formatPrice(reservation.reservation_fee_kobo)} · ${reservation.payment_status === 'paid' ? 'paid via Paystack' : 'payment pending'}` : 'Free reservation'}</p>{reservation.notes && <p>{reservation.notes}</p>}</div>
            <label className="reservation-status-control"><span>Reservation status</span><select value={reservation.status} onChange={(event) => void updateReservation(reservation.id, event.target.value)}>{['pending', 'confirmed', 'cancelled', 'completed'].map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
          </article>
        ))}</div>}
      </section>

      <section className="admin-panel product-editor" id="product-editor">
        <div className="admin-panel-heading"><div><p className="eyebrow">MENU MANAGEMENT</p><h2>{editing ? 'Edit dish' : 'Add a dish'}</h2><p className="muted">Set the name, price, and details customers see.</p></div>{editing && <button className="plain-btn" type="button" onClick={() => { setEditing(null); setForm(emptyForm); }}>Cancel edit</button>}</div>
        <form className="product-form" onSubmit={saveProduct}>
          <label className="field"><span>Dish name</span><input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required maxLength={120} placeholder="e.g. Jollof rice with grilled chicken" /></label>
          <label className="field"><span>Price (₦)</span><input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} required placeholder="0.00" /></label>
          <label className="field"><span>Stock quantity</span><input type="number" inputMode="numeric" min="0" max="1000000" step="1" value={form.stockQuantity} onChange={(event) => setForm({ ...form, stockQuantity: event.target.value })} placeholder="Leave blank to stop tracking" /><small>Orders reduce this count; zero marks the dish out of stock. Blank keeps stock untracked.</small></label>
          <label className="field field-full"><span>Description</span><textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={500} placeholder="Tell customers what makes this dish special" /></label>
          <label className="field"><span>Category</span><select value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })}><option value="">Choose a category</option>{categories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
          <label className="field field-full photo-url-field"><span>Photo URL <small>(optional)</small></span><input type="text" inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} dir="ltr" value={form.imageUrl} onChange={(event) => setForm({ ...form, imageUrl: event.target.value })} placeholder="https://example.com/dish.jpg" /><small className="photo-url-help">Paste a public image URL or choose a photo to upload.</small></label>
          <div className="field field-full photo-upload-field"><span>Upload photo <small>(JPG, PNG, or WebP; up to 15 MB, automatically optimized)</small></span><button className="btn photo-upload-button" type="button" onClick={() => photoInput.current?.click()} disabled={busy || uploadingPhoto}>{uploadingPhoto ? 'Uploading…' : 'Choose image'}</button><input ref={photoInput} className="photo-file-input" id="product-photo" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || uploadingPhoto} onChange={(event) => { void uploadProductPhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }} />{form.imageUrl && <div className="photo-preview"><img src={form.imageUrl} alt="Dish photo preview" /><span>Photo ready to save</span></div>}</div>
          <label className="availability-toggle"><input type="checkbox" checked={form.available} onChange={(event) => setForm({ ...form, available: event.target.checked })} /><span className="toggle-copy"><b>Available on the menu</b><small>Customers can see and order this dish.</small></span></label>
          <div className="product-form-actions"><button className="btn" type="submit" disabled={busy || uploadingPhoto}>{busy ? 'Saving…' : uploadingPhoto ? 'Uploading photo…' : editing ? 'Save changes' : 'Publish dish'} <span aria-hidden="true">→</span></button></div>
        </form>
      </section>

      <section className="admin-panel" aria-labelledby="products-title">
        <div className="admin-panel-heading list-heading"><div><p className="eyebrow">YOUR CATALOG</p><h2 id="products-title">Menu items <span className="count-pill">{products.length}</span></h2></div></div>
        {products.length === 0 ? <div className="admin-empty"><strong>Your menu is ready for its first dish</strong><p>Publish a dish above and it’ll be available to customers.</p></div> : <div className="product-list">{products.map((product) => (
          <article className="product-row" key={product.id}>
            <div className="product-thumb">{product.image_url ? <img src={product.image_url} alt="" loading="lazy" /> : <span aria-hidden="true">✦</span>}</div>
            <div className="product-row-copy"><div className="product-title-line"><h3>{product.name}</h3><span className={!product.available ? 'status-pill hidden' : product.stock_quantity === 0 ? 'status-pill hidden' : 'status-pill available'}>{!product.available ? 'Hidden' : product.stock_quantity === 0 ? 'Out of stock' : 'Published'}</span></div><p>{product.description || 'No description added.'}</p><small className="stock-summary">{product.stock_quantity === null ? 'Stock not tracked' : `${product.stock_quantity} in stock`}</small></div>
            <strong className="product-price">{formatPrice(product.price_kobo)}</strong>
            <div className="product-actions"><button className="text-action" onClick={() => editProduct(product)}>Edit</button><button className="text-action danger" onClick={() => void removeProduct(product.id)}>Remove</button></div>
          </article>
        ))}</div>}
      </section>

      <section className="admin-panel" aria-labelledby="orders-title">
        <div className="admin-panel-heading list-heading"><div><p className="eyebrow">FULFILLMENT</p><h2 id="orders-title">Customer orders <span className="count-pill">{orders.length}</span></h2><p className="muted">Orders appear here with payment and delivery details.</p></div></div>
        <div className="order-filters"><input aria-label="Search orders" placeholder="Search name, phone, email, or order number" value={orderSearch} onChange={(e)=>setOrderSearch(e.target.value)}/><select aria-label="Filter order status" value={orderFilter} onChange={(e)=>setOrderFilter(e.target.value)}><option value="">All statuses</option>{orderStatuses.map((s)=><option key={s} value={s}>{s.replaceAll('_',' ')}</option>)}</select><select aria-label="Filter fulfillment method" value={fulfillmentFilter} onChange={(e)=>setFulfillmentFilter(e.target.value)}><option value="">Delivery and pickup</option><option value="delivery">Delivery only</option><option value="pickup">Pickup only</option></select></div>
        {orders.length === 0 ? <div className="admin-empty"><strong>No matching orders</strong><p>Try another fulfillment method, status, or search.</p></div> : <div className="order-list">{orders.map((order) => (
          <article className="admin-order" key={order.id}>
            <div className="order-topline"><div><span className="order-id">ORDER · {order.id.slice(0, 8).toUpperCase()}</span><h3>{order.customer_name}</h3><p className="muted">{order.customer_email}{order.customer_phone ? ` · ${order.customer_phone}` : ''}</p></div><div className="order-value"><strong>{formatPrice(order.total_kobo)}</strong><span className={order.payment_status === 'paid' ? 'status-pill available' : 'status-pill hidden'}>{order.payment_status}</span>{order.payment_status !== 'paid' && <button className="text-action" type="button" disabled={verifyingOrder === order.id} onClick={() => void verifyOrderPayment(order.id)}>{verifyingOrder === order.id ? 'Checking…' : 'Check payment'}</button>}</div></div>
            <div className="order-details"><div><span className="detail-label">{order.fulfillment_type === 'pickup' ? 'PICKUP ORDER' : 'DELIVERY ADDRESS'}</span><p>{order.fulfillment_type === 'pickup' ? (settings.address ? `Customer pickup · ${settings.address}` : 'Customer pickup at restaurant') : (order.delivery_address || 'No address provided')}</p>{order.fulfillment_type === 'delivery' && order.delivery_address && <div className="location-actions"><a className="location-button" href={mapUrlForAddress(order.delivery_address)} target="_blank" rel="noreferrer">Open map ↗</a><button className="location-button" type="button" onClick={() => void copyOrderLocation(order.delivery_address)}>Copy map link</button></div>}<small>{order.fulfillment_type === 'pickup' ? 'No delivery fee' : `Delivery fee ${formatPrice(order.delivery_fee_kobo || 0)}`}</small></div><div><span className="detail-label">ITEMS</span><p>{Array.isArray(order.items) ? order.items.map((item) => <span className="admin-order-item" key={`${item.id}-${item.name}`}>{`${item.quantity} × ${item.name}`}{item.special_request && <small>Special request: {item.special_request}</small>}</span>) : 'Order details unavailable'}</p></div></div>
            <div className="order-bottomline"><span className="muted order-date">{formatDate(order.created_at)}</span><div className="status-control"><label><span>Order status</span><span className={`order-status-chip status-${(order.status || 'unknown').replaceAll('_', '-')}`}><i aria-hidden="true" />{order.status ? order.status.replaceAll('_', ' ') : 'Status unavailable'}</span><select value={orderStatuses.includes(order.status) ? order.status : ''} onChange={(event) => void updateOrder(order.id, event.target.value)}>{!orderStatuses.includes(order.status) && <option value="">Status unavailable</option>}{orderStatuses.filter((status) => order.fulfillment_type !== 'pickup' || status !== 'out_for_delivery').map((status) => <option key={status} value={status}>{status.replaceAll('_', ' ')}</option>)}</select></label><Link className="btn order-receipt-button" href={`/order/${order.id}`} target="_blank">View order <span aria-hidden="true">↗</span></Link></div></div>
          </article>
        ))}</div>}
      </section>

      <footer className="admin-footer"><span>Restaurant staff dashboard</span><Link href="/">View customer storefront ↗</Link></footer>
    </main>
  );
}
