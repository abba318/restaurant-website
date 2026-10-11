'use client';

import Link from 'next/link';
import { use, useEffect, useState } from 'react';

type Verification = { valid: boolean; orderNumber?: string; createdAt?: string; totalKobo?: number; status?: string; paymentStatus?: string; error?: string };
const money = (amount: number) => `₦${(amount / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function VerifyOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [data, setData] = useState<Verification | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/orders/${encodeURIComponent(id)}/verify`, { cache: 'no-store', signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'This order could not be verified.'); return body as Verification; })
      .then(setData)
      .catch((error: unknown) => { if (!controller.signal.aborted) setData({ valid: false, error: error instanceof Error ? error.message : 'This order could not be verified.' }); });
    return () => controller.abort();
  }, [id]);
  return <main className="wrap payment-result-page">
    <section className={`payment-result-card ${data?.valid ? 'success' : data ? 'failed' : 'checking'}`} aria-live="polite">
      <div className="payment-result-icon" aria-hidden="true">{data ? data.valid ? '✓' : '!' : '…'}</div>
      <p className="eyebrow">ORDER VERIFICATION</p>
      <h1>{data ? data.valid ? 'Verified order' : 'Could not verify order' : 'Checking order'}</h1>
      {!data ? <p className="muted">Please wait while we check the restaurant records.</p> : data.valid ? <>
        <p className="muted">This order matches the restaurant’s records.</p>
        <dl className="verify-details"><div><dt>Order</dt><dd>#{data.orderNumber}</dd></div><div><dt>Payment</dt><dd>{data.paymentStatus}</dd></div><div><dt>Order status</dt><dd>{data.status?.replaceAll('_', ' ')}</dd></div><div><dt>Total</dt><dd>{money(Number(data.totalKobo || 0))}</dd></div>{data.createdAt && <div><dt>Placed</dt><dd>{new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.createdAt))}</dd></div>}</dl>
      </> : <p className="muted">{data.error || 'The order was not found.'}</p>}
      <Link className="result-secondary" href="/">Return to restaurant</Link>
    </section>
    <style jsx>{`.verify-details{display:grid;gap:0;margin:24px 0;text-align:left;border-top:1px solid #e9e7e1}.verify-details div{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid #e9e7e1}.verify-details dt{color:#777}.verify-details dd{margin:0;text-align:right;text-transform:capitalize;font-weight:700}`}</style>
  </main>;
}
