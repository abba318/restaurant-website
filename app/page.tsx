'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import ThemeToggle from '@/components/theme-toggle';
import { addToCart, getCart, refreshCart } from '@/lib/cart';
import type { CartItem, MenuItem } from '@/types';

type Category = { id: number; name: string };

const formatPrice = (priceKobo: number) =>
  `₦${(priceKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Home() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const noticeTimer = useRef<number | null>(null);

  useEffect(() => {
    setCart(getCart());
    const syncCart = () => setCart(getCart());
    window.addEventListener('cart_updated', syncCart);
    window.addEventListener('storage', syncCart);
    const controller = new AbortController();

    fetch('/api/menu', { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('We couldn’t load the menu. Please try again.');
        return response.json();
      })
      .then((data) => {
        const menuItems = Array.isArray(data.items) ? data.items : [];
        setItems(menuItems);
        setCategories(Array.isArray(data.categories) ? data.categories : []);
        const refreshed = refreshCart(menuItems);
        setCart(refreshed.cart);
        if (refreshed.removed) setNotice(`${refreshed.removed} unavailable ${refreshed.removed === 1 ? 'item was' : 'items were'} removed from your order.`);
      })
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === 'AbortError') return;
        setError(cause instanceof Error ? cause.message : 'We couldn’t load the menu. Please try again.');
      })
      .finally(() => setLoading(false));

    return () => {
      controller.abort();
      window.removeEventListener('cart_updated', syncCart);
      window.removeEventListener('storage', syncCart);
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return items.filter((item) => {
      const matchesCategory = activeCategory === 'All' || String(item.category_id) === activeCategory;
      const matchesSearch = !query || `${item.name} ${item.description}`.toLocaleLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, items, search]);

  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const cartTotal = cart.reduce((total, item) => total + item.price_kobo * item.quantity, 0);
  const featuredItem = items.find((item) => item.available && item.stock_quantity !== 0 && item.image_url) || items.find((item) => item.available && item.stock_quantity !== 0);

  function add(item: MenuItem) {
    const quantityInCart = cart.find((cartItem) => cartItem.id === item.id)?.quantity || 0;
    const stockLimit = item.stock_quantity ?? 99;
    if (stockLimit === 0) {
      setNotice(`${item.name} is out of stock.`);
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(''), 2800);
      return;
    }
    if (quantityInCart >= Math.min(99, stockLimit)) {
      setNotice(item.stock_quantity !== null && item.stock_quantity !== undefined
        ? `Only ${item.stock_quantity} ${item.name} ${item.stock_quantity === 1 ? 'portion is' : 'portions are'} available.`
        : 'You’ve reached the maximum quantity for this dish.');
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(''), 2800);
      return;
    }
    setCart(addToCart(item));
    setNotice(`${item.name} added to your cart.`);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2800);
  }

  return (
    <main className={`wrap storefront${cartCount ? ' has-cart-dock' : ''}`}>
      <a href="#menu" className="skip-link">Skip to menu</a>
      <nav className="nav" aria-label="Main navigation">
        <Link href="/" className="brand" aria-label="Restaurant home">
          <span className="brand-mark" aria-hidden="true">R</span>
          <span className="brand-name">Restaurant<span className="brand-caption">MADE WITH CARE</span></span>
        </Link>
        <div className="nav-actions">
          <a href="#menu" className="nav-menu-link">Menu</a>
          <Link href="/orders" className="nav-menu-link">My orders</Link>
          <Link href="/reservations" className="nav-menu-link">Reserve a table</Link>
          <Link href="/checkout" className="cart-link" aria-label={`Open cart, ${cartCount} items`}>
            <span className="cart-label">Cart</span><span className="cart-count">{cartCount}</span>
          </Link>
          <ThemeToggle />
        </div>
      </nav>

      <section className="hero">
        <div className="hero-content">
          <p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true">✳</span> GOOD FOOD, MADE FOR YOUR TABLE</p>
          <h1>A good meal<br />changes <em>everything.</em></h1>
          <p className="hero-copy">The kind of food you look forward to. Find a new favourite, revisit an old one, and we’ll have it ready for your table.</p>
          <a href="#menu" className="btn hero-btn">Find your next favourite <span aria-hidden="true">↘</span></a>
          <div className="hero-promise"><span aria-hidden="true">✦</span> Good food. No fuss. Just a few taps away.</div>
        </div>
        <div className="hero-showcase">
          <div className="hero-photo">
            {featuredItem?.image_url ? (
              <img src={featuredItem.image_url} alt="" />
            ) : (
              <div className="hero-plate" aria-hidden="true"><span>✦</span><i /><i /><i /><i /></div>
            )}
            <div className="hero-photo-shade" />
            <span className="hero-photo-tag"><span aria-hidden="true">✦</span> A little something good</span>
            {featuredItem && <div className="hero-photo-caption"><span>ON THE MENU</span><strong>{featuredItem.name}</strong><b>{formatPrice(featuredItem.price_kobo)}</b></div>}
          </div>
          <div className="hero-note"><span className="hero-note-icon" aria-hidden="true">R</span><span><strong>Good food, your way</strong><small>Choose a favourite and we’ll take it from there.</small></span></div>
          <span className="hero-spark hero-spark-one" aria-hidden="true">✦</span>
          <span className="hero-spark hero-spark-two" aria-hidden="true">✳</span>
        </div>
      </section>

      <section id="menu" className="menu-section" aria-labelledby="menu-title">
        <div className="menu-heading">
          <div><p className="eyebrow"><span className="eyebrow-mark" aria-hidden="true">✳</span> A SEAT AT OUR TABLE</p><h2 id="menu-title">A menu worth slowing down for.</h2></div>
          <p className="muted menu-intro">Take a look around. When something catches your eye, it’s only a tap away.</p>
        </div>

        <div className="menu-tools">
          <div className="category-tabs" aria-label="Filter menu by category">
            <button type="button" aria-pressed={activeCategory === 'All'} className={activeCategory === 'All' ? 'category-tab active' : 'category-tab'} onClick={() => setActiveCategory('All')}>Everything</button>
            {categories.map((category) => (
              <button type="button" key={category.id} aria-pressed={activeCategory === String(category.id)} className={activeCategory === String(category.id) ? 'category-tab active' : 'category-tab'} onClick={() => setActiveCategory(String(category.id))}>
                {category.name}
              </button>
            ))}
          </div>
          <label className="menu-search">
            <span className="sr-only">Search menu</span>
            <span aria-hidden="true">⌕</span>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search dishes" />
          </label>
        </div>

        {!loading && !error && items.length > 0 && <div className="menu-result-count" aria-live="polite"><span className="menu-result-dot" aria-hidden="true" />{visibleItems.length} {visibleItems.length === 1 ? 'dish' : 'dishes'} to discover</div>}

        {notice && <p className="notice success-notice" role="status">{notice}</p>}
        {error && <div className="menu-state error-state" role="alert"><strong>Menu unavailable</strong><p>{error}</p><button className="plain-btn" onClick={() => window.location.reload()}>Try again</button></div>}
        {loading && <div className="grid" aria-label="Loading menu">{Array.from({ length: 4 }, (_, index) => <div className="card skeleton-card" key={index}><div className="skeleton-image"/><div className="card-body"><div className="skeleton-line"/><div className="skeleton-line short"/></div></div>)}</div>}
        {!loading && !error && visibleItems.length === 0 && (
          <div className="menu-state"><strong>{items.length ? 'No dishes match your search' : 'The menu is being updated'}</strong><p>{items.length ? 'Try another search or category.' : 'Please check back soon.'}</p>{items.length > 0 && <button className="plain-btn" onClick={() => { setSearch(''); setActiveCategory('All'); }}>Clear filters</button>}</div>
        )}
        {!loading && !error && visibleItems.length > 0 && (
          <div className="grid">
            {visibleItems.map((item, index) => (
              <article className="card dish-card" key={item.id}>
                <div className={`dish-art dish-${index % 4}`}>
                  {item.image_url ? <img src={item.image_url} alt={item.name} loading="lazy" /> : <span aria-hidden="true">{['✦', '●', '◆', '✺'][index % 4]}</span>}
                </div>
                <div className="card-body">
                  <div className="dish-copy"><h3>{item.name}</h3><p className="muted">{item.description || 'A delicious choice from our menu.'}</p></div>
                  <div className="card-footer"><b>{formatPrice(item.price_kobo)}</b><button className="btn add-btn" onClick={() => add(item)} disabled={item.stock_quantity === 0} aria-label={item.stock_quantity === 0 ? `${item.name} is out of stock` : `Add ${item.name} to your order`}>{item.stock_quantity === 0 ? 'Sold out' : <>Add <span aria-hidden="true">+</span></>}</button></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="storefront-footer"><span>Restaurant</span><a href="#menu">Explore menu</a><Link href="/checkout" className="view-order-footer">Cart</Link><Link href="/orders">My orders</Link><Link href="/reservations">Reserve a table</Link><Link href="/admin">Staff sign in</Link></footer>
      {cartCount > 0 && (
        <Link href="/checkout" className="mobile-cart-dock" aria-label={`Checkout with ${cartCount} ${cartCount === 1 ? 'item' : 'items'}, total ${formatPrice(cartTotal)}`}>
          <span className="mobile-cart-copy"><strong>Cart</strong><small>{cartCount} {cartCount === 1 ? 'item' : 'items'}</small></span>
          <span className="mobile-cart-total">{formatPrice(cartTotal)} <span aria-hidden="true">→</span></span>
        </Link>
      )}
    </main>
  );
}
