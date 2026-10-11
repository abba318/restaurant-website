'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { clearCart } from '@/lib/cart';

type Result = 'checking' | 'success' | 'failed' | 'attention';
type PaymentResult = { status: string; orderStatus?: string; orderId?: string; reservationId?: number };

export default function Callback() {
  const [result, setResult] = useState<Result>('checking');
  const [message, setMessage] = useState('We’re confirming your payment with Paystack.');
  const [retryCount, setRetryCount] = useState(0);
  const [orderId, setOrderId] = useState('');
  const [reservationId, setReservationId] = useState<number | null>(null);

  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('reference');
    if (!reference) {
      setResult('failed');
      setMessage('We couldn’t find a payment reference for this checkout.');
      return;
    }

    const controller = new AbortController();
    fetch(`/api/payments/verify?reference=${encodeURIComponent(reference)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Payment verification is taking longer than expected.');
        return data;
      })
      .then((data: PaymentResult) => {
        if (data.status === 'success') {
          setOrderId(data.orderId || '');
          setReservationId(data.reservationId ?? null);
          if (data.reservationId) {
            setResult('success');
            setMessage('Your reservation fee is confirmed. The restaurant will contact you to confirm your requested table time.');
          } else if (data.orderStatus === 'cancelled') {
            clearCart();
            setResult('attention');
            setMessage('Your payment was received, but this order was cancelled. Please contact the restaurant directly for help.');
          } else {
            clearCart();
            setResult('success');
            setMessage('Your payment is confirmed. Thank you for ordering with us.');
          }
        } else {
          setResult('failed');
          setMessage('Payment was not completed. Your order has not been confirmed.');
        }
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === 'AbortError') return;
        setResult('failed');
        setMessage(cause instanceof Error ? cause.message : 'We could not verify your payment.');
      });

    return () => controller.abort();
  }, [retryCount]);

  return (
    <main className="wrap payment-result-page">
      <section className={`payment-result-card ${result}`} aria-live="polite">
        <div className="payment-result-icon" aria-hidden="true">{result === 'checking' ? '…' : result === 'success' ? '✓' : '!'}</div>
        <p className="eyebrow">{result === 'checking' ? 'PAYMENT STATUS' : result === 'success' ? reservationId ? 'RESERVATION FEE PAID' : 'ORDER CONFIRMED' : result === 'attention' ? 'PAYMENT RECEIVED · ACTION NEEDED' : 'PAYMENT NOT CONFIRMED'}</p>
        <h1>{result === 'checking' ? 'One moment' : result === 'success' ? reservationId ? 'Your reservation request is paid' : 'Thank you for your order' : result === 'attention' ? 'Please contact the restaurant' : 'Let’s get this sorted'}</h1>
        <p className="muted">{message}</p>
        {result === 'checking' ? <span className="verification-loader" aria-label="Verifying payment" /> : <div className="payment-result-actions">{result === 'failed' && <button className="btn" type="button" onClick={() => setRetryCount((count) => count + 1)}>Retry verification</button>}{result === 'success' && orderId && <Link className="btn" href={`/order/${orderId}`}>View receipt and track order</Link>}{result === 'success' && reservationId && <Link className="btn" href="/reservations">Make another reservation</Link>}<Link className={result === 'failed' ? 'result-secondary' : 'btn'} href="/">Back to the menu</Link></div>}
      </section>
    </main>
  );
}
