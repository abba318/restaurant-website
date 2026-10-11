'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import ThemeToggle from '@/components/theme-toggle';

async function readResult<T = { message: string }>(response: Response): Promise<T> {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || 'Unable to submit your reservation.');
  return result as T;
}

type ReservationSubmitResult = { id: number; reservationFeeKobo: number; message: string; authorization_url?: string };

export default function ReservationsPage() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pricing, setPricing] = useState<{ reservationFree: boolean; reservationFeeKobo: number } | null>(null);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());

  useEffect(() => {
    fetch('/api/reservations', { cache: 'no-store' })
      .then((response) => readResult<{ reservationFree: boolean; reservationFeeKobo: number }>(response))
      .then(setPricing)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Unable to load reservation pricing.'));
  }, []);

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    setBusy(true); setError(''); setMessage('');
    const form = new FormData(formElement);
    const payload = {
      name: String(form.get('name') || ''), email: String(form.get('email') || ''), phone: String(form.get('phone') || ''),
      date: String(form.get('date') || ''), time: String(form.get('time') || ''), partySize: Number(form.get('partySize')),
      notes: String(form.get('notes') || ''),
    };
    try {
      const result = await readResult<ReservationSubmitResult>(await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }));
      if (result.authorization_url) {
        window.location.assign(result.authorization_url);
        return;
      }
      setMessage(result.message);
      formElement.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to submit your reservation.');
    } finally { setBusy(false); }
  }

  return (
    <main className="wrap checkout-page">
      <nav className="nav" aria-label="Reservation navigation">
        <Link href="/" className="back-link">← <span>Back to menu</span></Link>
        <Link href="/" className="brand" aria-label="Restaurant home"><span className="brand-mark">R</span> Restaurant</Link>
        <ThemeToggle />
      </nav>
      <header className="checkout-header">
        <p className="eyebrow">SAVE A PLACE AT OUR TABLE</p>
        <h1>Reserve a table</h1>
        <p className="muted">Choose your preferred time and party size. Paid bookings are submitted after Paystack confirms the reservation fee.</p>
        {pricing && <p className="reservation-price-note" role="status">{pricing.reservationFree || pricing.reservationFeeKobo === 0 ? 'There is no reservation fee.' : `Reservation fee: ₦${(pricing.reservationFeeKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} per booking, paid securely with Paystack.`}</p>}
      </header>
      <form className="card order-card reservation-form" onSubmit={reserve}>
        <div className="form-grid">
          <label className="field"><span>Your name</span><input name="name" autoComplete="name" maxLength={120} required /></label>
          <label className="field"><span>Email address</span><input name="email" type="email" autoComplete="email" maxLength={254} required /></label>
          <label className="field"><span>Phone number</span><input name="phone" type="tel" autoComplete="tel" minLength={7} maxLength={32} required /></label>
          <label className="field"><span>Guests</span><input name="partySize" type="number" min={1} max={20} defaultValue={2} required /></label>
          <label className="field"><span>Date</span><input name="date" type="date" min={today} required /></label>
          <label className="field"><span>Time</span><input name="time" type="time" required /></label>
          <label className="field field-full"><span>Special requests <small>(optional)</small></span><textarea name="notes" maxLength={500} rows={3} placeholder="Accessibility needs, occasion, or seating preference" /></label>
        </div>
        {error && <p className="admin-error" role="alert">{error}</p>}
        {message && <p className="admin-success" role="status">{message}</p>}
        <button className="btn pay-btn" type="submit" disabled={busy || !pricing}>{!pricing ? 'Loading reservation details…' : busy ? 'Preparing…' : pricing.reservationFree || pricing.reservationFeeKobo === 0 ? 'Request a reservation' : 'Pay with Paystack'} <span aria-hidden="true">→</span></button>
      </form>
      <footer className="storefront-footer"><Link href="/">Restaurant</Link><Link href="/orders">My orders</Link><Link href="/admin">Staff sign in</Link></footer>
    </main>
  );
}
