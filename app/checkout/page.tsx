'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import ThemeToggle from '@/components/theme-toggle';
import { getCart, refreshCart, updateQuantity, updateSpecialRequest } from '@/lib/cart';
import { rememberOrder } from '@/lib/order-history';
import type { CartItem } from '@/types';

const formatPrice = (priceKobo: number) =>
  `₦${(priceKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Checkout() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [instructions, setInstructions] = useState('');
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery');
  const [restaurant, setRestaurant] = useState<{deliveryEnabled?:boolean;pickupEnabled?:boolean;deliveryFeeKobo?:number;address?:string}>({});
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cartReady, setCartReady] = useState(false);
  const [cartVerificationFailed, setCartVerificationFailed] = useState(false);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationMessage, setLocationMessage] = useState('');
  const [sharedCoordinates, setSharedCoordinates] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    setCart(getCart());
    const syncCart = () => setCart(getCart());
    window.addEventListener('cart_updated', syncCart);
    window.addEventListener('storage', syncCart);
    const controller = new AbortController();
    fetch('/api/menu', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('We could not verify current prices. Please try again.');
        return response.json();
      })
      .then((data) => {
        const options = data.restaurant || {};
        setRestaurant(options);
        if (options.deliveryEnabled === false && options.pickupEnabled !== false) setFulfillment('pickup');
        else if (options.pickupEnabled === false && options.deliveryEnabled !== false) setFulfillment('delivery');
        const refreshed = refreshCart(Array.isArray(data.items) ? data.items : []);
        setCart(refreshed.cart);
        if (refreshed.removed) setMessage(`${refreshed.removed} unavailable ${refreshed.removed === 1 ? 'item was' : 'items were'} removed from your order.`);
        setCartReady(true);
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === 'AbortError') return;
        setMessage(cause instanceof Error ? cause.message : 'We could not verify current prices. Please try again.');
        setCartVerificationFailed(true);
        setCartReady(true);
      });
    return () => {
      controller.abort();
      window.removeEventListener('cart_updated', syncCart);
      window.removeEventListener('storage', syncCart);
    };
  }, []);

  const subtotal = cart.reduce((sum, item) => sum + item.price_kobo * item.quantity, 0);
  const deliveryFee = fulfillment === 'delivery' ? Number(restaurant.deliveryFeeKobo || 0) : 0;
  const total = subtotal + deliveryFee;

  function changeQuantity(id: number, quantity: number) {
    setCart(updateQuantity(id, quantity));
  }

  function changeSpecialRequest(id: number, specialRequest: string) {
    setCart(updateSpecialRequest(id, specialRequest));
  }

  function shareCurrentLocation() {
    setLocationMessage('');
    setSharedCoordinates(null);
    if (!navigator.geolocation) {
      setLocationMessage('Location sharing is not available in this browser. Enter your street address instead.');
      return;
    }
    setLocationBusy(true);
    navigator.geolocation.getCurrentPosition((position) => {
      const latitude = position.coords.latitude;
      const longitude = position.coords.longitude;
      const formattedLatitude = latitude.toFixed(6);
      const formattedLongitude = longitude.toFixed(6);
      const coordinates = `${formattedLatitude}, ${formattedLongitude}`;
      const mapUrl = `https://maps.google.com/?q=${formattedLatitude},${formattedLongitude}`;
      const pin = `Map pin: ${latitude}, ${longitude} (${mapUrl})`;
      const nextAddress = address.trim() ? `${address.trim()}\n${pin}` : pin;
      if (nextAddress.length > 500) setLocationMessage('Your address is too long to add a map pin. Shorten it and try again.');
      else { setAddress(nextAddress); setSharedCoordinates({ latitude, longitude }); setLocationMessage('GPS pin added. Add a street or landmark if you can.'); }
      setLocationBusy(false);
    }, (cause) => {
      const message = cause.code === 1
        ? 'Location permission is off. Allow it in your browser settings, or enter your address manually.'
        : cause.code === 3
          ? 'Location request timed out. Try again or enter your address manually.'
          : 'We could not read your location. Check device location services or enter your address manually.';
      setLocationMessage(message);
      setLocationBusy(false);
    }, { enableHighAccuracy: true, timeout: 30000, maximumAge: 60000 });
  }

  async function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cartReady) return;
    if (cartVerificationFailed) return;
    if (!cart.length) {
      setMessage('Your order is empty. Add a dish from the menu to continue.');
      return;
    }

    setSubmitting(true);
    setMessage('Creating your order…');
    try {
      const orderResponse = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer: { name: name.trim(), email: email.trim(), phone: phone.trim(), address: address.trim(), instructions: instructions.trim() },
          location: fulfillment === 'delivery' ? sharedCoordinates : null,
          fulfillment,
          items: cart.map(({ id, quantity, specialRequest }) => ({ id, quantity, specialRequest: specialRequest || '' })),
        }),
      });
      const order = await orderResponse.json();
      if (!orderResponse.ok || !order.id) throw new Error(order.error || 'Unable to create the order.');
      rememberOrder(order.id);

      const paymentResponse = await fetch('/api/payments/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id }),
      });
      const payment = await paymentResponse.json();
      if (!paymentResponse.ok || !payment.authorization_url) throw new Error(payment.error || 'Unable to start payment.');

      window.location.assign(payment.authorization_url);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <main className="wrap checkout-page">
      <nav className="nav" aria-label="Checkout navigation">
        <Link href="/" className="back-link">← <span>Back to menu</span></Link>
        <Link href="/" className="brand" aria-label="Restaurant home"><span className="brand-mark">R</span> Restaurant</Link>
        <ThemeToggle />
      </nav>

      <header className="checkout-header">
        <p className="eyebrow">ALMOST THERE</p>
        <h1>Complete your order</h1>
        <p className="muted">Review your items and add your delivery details.</p>
      </header>

      {cart.length === 0 ? (
        <section className="empty-cart card">
          <span className="empty-cart-icon" aria-hidden="true">＋</span>
          <h2>Your cart is waiting</h2>
          <p className="muted">Add a few dishes from the menu and they’ll show up here.</p>
          <Link href="/#menu" className="btn">Browse the menu</Link>
        </section>
      ) : (
        <div className="checkout-grid">
          <form className="card order-card checkout-form" onSubmit={pay}>
            <section aria-labelledby="order-title">
              <div className="checkout-section-heading"><span>01</span><h2 id="order-title">Your order</h2></div>
              <div className="checkout-items">
                {cart.map((item) => (
                  <div className="cart-row" key={item.id}>
                    <div className="checkout-item-name"><b>{item.name}</b><small>{formatPrice(item.price_kobo)} each</small><label className="field order-special-request"><span>Special request <small>(optional)</small></span><textarea value={item.specialRequest || ''} onChange={(event) => changeSpecialRequest(item.id, event.target.value)} maxLength={250} rows={2} placeholder="e.g. no onions" /></label></div>
                    <span className="quantity" aria-label={`${item.quantity} ${item.name}`}>
                      <button type="button" aria-label={`Remove one ${item.name}`} onClick={() => changeQuantity(item.id, item.quantity - 1)}>−</button>
                      <b aria-live="polite">{item.quantity}</b>
                      <button type="button" aria-label={`Add one ${item.name}`} onClick={() => changeQuantity(item.id, item.quantity + 1)}>+</button>
                    </span>
                    <strong className="line-total">{formatPrice(item.price_kobo * item.quantity)}</strong>
                  </div>
                ))}
              </div>
              <div className="total-row"><span>Food subtotal</span><strong>{formatPrice(subtotal)}</strong></div>
              <div className="total-row"><span>{fulfillment === 'pickup' ? 'Pickup' : 'Delivery fee'}</span><strong>{formatPrice(deliveryFee)}</strong></div>
              <div className="total-row"><span>Total</span><strong>{formatPrice(total)}</strong></div>
            </section>

            <section className="details-section" aria-labelledby="details-title">
              <div className="checkout-section-heading"><span>02</span><h2 id="details-title">Delivery details</h2></div>
              <div className="form-grid">
                <fieldset className="field field-full fulfillment-choice" disabled={restaurant.deliveryEnabled === false && restaurant.pickupEnabled === false}><legend>How would you like your order?</legend>{restaurant.deliveryEnabled !== false && <label><input type="radio" name="fulfillment" checked={fulfillment === 'delivery'} onChange={() => setFulfillment('delivery')} /> Delivery to your address</label>}{restaurant.pickupEnabled !== false && <label><input type="radio" name="fulfillment" checked={fulfillment === 'pickup'} onChange={() => setFulfillment('pickup')} /> Pick up at the restaurant</label>}{fulfillment === 'pickup' && restaurant.address && <p className="muted">Pickup location: {restaurant.address}</p>}{restaurant.deliveryEnabled === false && restaurant.pickupEnabled === false && <p className="notice" role="status">Online ordering is temporarily unavailable.</p>}</fieldset>
                <label className="field"><span>Full name</span><input autoComplete="name" name="name" placeholder="Your name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label>
                <label className="field"><span>Email address</span><input autoComplete="email" name="email" placeholder="you@example.com" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required maxLength={254} /></label>
                <label className="field field-full"><span>Phone number</span><input autoComplete="tel" name="phone" placeholder="A number we can reach you on" type="tel" pattern="\+?[0-9().\s-]{7,32}" title="Enter a phone number using digits, spaces, or + ( ) -" value={phone} onChange={(event) => setPhone(event.target.value)} required maxLength={32} /></label>
                {fulfillment === 'delivery' && <div className="field field-full location-field"><label htmlFor="delivery-address">Delivery address</label>{sharedCoordinates && <span className="gps-coordinate-chip">GPS pin · {sharedCoordinates.latitude.toFixed(6)}, {sharedCoordinates.longitude.toFixed(6)}</span>}<textarea id="delivery-address" autoComplete="street-address" name="address" placeholder={sharedCoordinates ? `GPS pin saved: ${sharedCoordinates.latitude.toFixed(6)}, ${sharedCoordinates.longitude.toFixed(6)}. Add your street or landmark.` : 'Street, area, and any helpful directions'} value={address} onChange={(event) => setAddress(event.target.value)} required minLength={8} maxLength={500} /><button className="location-button" type="button" onClick={shareCurrentLocation} disabled={locationBusy}>{locationBusy ? 'Getting location…' : '⌖ Share my current location'}</button>{locationMessage && <small className="location-message" role="status" aria-live="polite">{locationMessage}</small>}</div>}
                <label className="field field-full"><span>Delivery instructions <small>(optional)</small></span><textarea name="instructions" placeholder="Gate code, landmarks, or other instructions" value={instructions} onChange={(event) => setInstructions(event.target.value)} maxLength={500} /></label>
              </div>
              <button className="btn pay-btn" type="submit" disabled={submitting || !cartReady || cartVerificationFailed || !cart.length || (restaurant.deliveryEnabled === false && restaurant.pickupEnabled === false)}>
                {!cartReady ? 'Verifying your order…' : submitting ? 'Preparing secure checkout…' : <>Continue to secure payment <span aria-hidden="true">→</span></>}
              </button>
              <p className="payment-note"><span aria-hidden="true">⌑</span> You’ll complete payment securely with Paystack.</p>
              {message && <p className="notice" role="status" aria-live="polite">{message}</p>}
              {cartVerificationFailed && <button className="plain-btn" type="button" onClick={() => window.location.reload()}>Retry price verification</button>}
            </section>
          </form>

          <aside className="checkout-aside">
            <div className="aside-icon" aria-hidden="true">✓</div>
            <h3>A clear, secure checkout</h3>
            <p className="muted">Your order total is confirmed before payment. Card details are handled securely by Paystack and never stored by this restaurant.</p>
            <div className="aside-divider" />
            <p className="aside-small">Need to change something?</p>
            <Link href="/#menu" className="aside-link">Return to the menu <span aria-hidden="true">→</span></Link>
          </aside>
        </div>
      )}
    </main>
  );
}
