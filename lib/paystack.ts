const PAYSTACK_API = 'https://api.paystack.co';

function secretKey() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key || !/^sk_(test|live)_[A-Za-z0-9]+$/.test(key)) throw new Error('Paystack is not configured.');
  return key;
}

async function readPaystackResponse(response: Response) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.status) throw new Error('Paystack could not complete the request.');
  return data.data;
}

export async function initialize(email: string, amount: number, reference: string, callbackUrl: string) {
  const response = await fetch(`${PAYSTACK_API}/transaction/initialize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount, currency: 'NGN', reference, callback_url: callbackUrl }),
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  return readPaystackResponse(response);
}

export async function verify(reference: string) {
  const response = await fetch(`${PAYSTACK_API}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretKey()}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  });
  return readPaystackResponse(response);
}
