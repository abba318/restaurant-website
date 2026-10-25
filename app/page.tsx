'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import ThemeToggle from '@/components/theme-toggle';
import { addToCart, getCart, refreshCart } from '@/lib/cart';
import type { CartItem, MenuItem } from '@/types';

type Category = { id: number; name: string };
type RestaurantSettings = {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  openingHours?: string;
  logoUrl?: string;
  deliveryEnabled?: boolean;
  pickupEnabled?: boolean;
};

type StudioIconName = 'bag' | 'search' | 'clock' | 'flame' | 'pin' | 'shield' | 'arrow' | 'check';

const iconPaths: Record<StudioIconName, [string, string?]> = {
  bag: ['M5 8h14l1 13H4L5 8Z', 'M9 8V6a3 3 0 0 1 6 0v2'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.35-4.35'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2'],
  flame: ['M12 22c4.3 0 7-3.1 7-7 0-3.2-1.8-5.4-4.4-7.9.2 2.1-.5 3.2-1.3 3.8C12.9 7.2 11.5 3.8 8.4 2 9 5.8 6 7.8 5 11.4 3.5 16.8 6.8 22 12 22Z', 'M12 22c2 0 3-1.4 3-3.1 0-1.1-.6-2-1.7-3.1.1 1.3-.5 2-1.3 2.3-.3-1.3-1-2.4-2.2-3.1.1 1.7-.9 2.4-1 3.8-.1 1.7 1 3.2 3.2 3.2Z'],
  pin: ['M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z', 'M12 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  shield: ['M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z', 'm9 12 2 2 4-4'],
  arrow: ['M7 17 17 7', 'M7 7h10v10'],
  check: ['m5 12 4 4L19 6'],
};

function StudioIcon({ name, className = '' }: { name: StudioIconName; className?: string }) {
  const [first, second] = iconPaths[name];
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={first} />
      {second && <path d={second} />}
    </svg>
  );
}

const formatPrice = (priceKobo: number) =>
  '₦' + (priceKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Home() {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [settings, setSettings] = useState<RestaurantSettings | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
        setSettings(data.restaurant && typeof data.restaurant === 'object' ? data.restaurant : null);
        const refreshed = refreshCart(menuItems);
        setCart(refreshed.cart);
        if (refreshed.removed) setNotice(refreshed.removed + ' unavailable ' + (refreshed.removed === 1 ? 'item was' : 'items were') + ' removed from your order.');
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
      const matchesSearch = !query || (item.name + ' ' + item.description).toLocaleLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [activeCategory, items, search]);

  const availableItems = items.filter((item) => item.available && item.stock_quantity !== 0);
  const highlights = availableItems.slice(0, 3);
  const featuredItem = availableItems.find((item) => Boolean(item.image_url)) || availableItems[0];
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);
  const cartTotal = cart.reduce((total, item) => total + item.price_kobo * item.quantity, 0);
  const configuredBrand = settings?.name?.trim();
  const brandName = configuredBrand && configuredBrand.toLocaleLowerCase() !== 'restaurant' ? configuredBrand : 'NaijaGrill';
  const ordersOpen = !settings || settings.deliveryEnabled !== false || settings.pickupEnabled !== false;

  function notify(message: string) {
    setNotice(message);
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 2800);
  }

  function add(item: MenuItem) {
    const quantityInCart = cart.find((cartItem) => cartItem.id === item.id)?.quantity || 0;
    const stockLimit = item.stock_quantity ?? 99;
    if (stockLimit === 0) {
      notify(item.name + ' is out of stock.');
      return;
    }
    if (quantityInCart >= Math.min(99, stockLimit)) {
      notify(item.stock_quantity !== null && item.stock_quantity !== undefined
        ? 'Only ' + item.stock_quantity + ' ' + item.name + (item.stock_quantity === 1 ? ' portion is' : ' portions are') + ' available.'
        : 'You’ve reached the maximum quantity for this dish.');
      return;
    }
    setCart(addToCart(item));
    notify(item.name + ' added to your food bag.');
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  return (
    <main className="studio-storefront">
      <a href="#menu" className="studio-skip-link">Skip to menu</a>

      <header className="studio-nav">
        <Link href="/" className="studio-brand" aria-label={brandName + ' home'}>
          {settings?.logoUrl ? <img className="studio-brand-logo" src={settings.logoUrl} alt="" /> : (
            <span className="studio-brand-mark"><StudioIcon name="flame" /></span>
          )}
          <span className="studio-brand-copy">
            <strong>{brandName}</strong>
            <small>Kitchen &amp; Charcoal Bar</small>
          </span>
        </Link>

        <nav className="studio-nav-links" aria-label="Main navigation">
          <a href="#menu">Our menu</a>
          {highlights.length > 0 && <a href="#specials">Kitchen picks</a>}
          <Link href="/orders">Track order</Link>
          <Link href="/reservations">Reservations</Link>
          <a href="#contact">Contact</a>
          <Link href="/admin" className="studio-staff-link"><StudioIcon name="shield" /> Staff portal</Link>
        </nav>

        <div className="studio-nav-actions">
          <span className={'studio-open-pill' + (ordersOpen ? '' : ' is-closed')}>
            <span className="studio-status-dot" />
            <span>{ordersOpen ? 'Online ordering open' : 'Ordering paused'}</span>
          </span>
          <Link href="/checkout" className="studio-cart-button" aria-label={'Open cart, ' + cartCount + (cartCount === 1 ? ' item' : ' items')}>
            <StudioIcon name="bag" />
            <span className="studio-cart-label">Cart</span>
            <span className="studio-cart-count">{cartCount}</span>
          </Link>
          <ThemeToggle />
          <button className="studio-menu-toggle" type="button" aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'} aria-expanded={mobileMenuOpen} aria-controls="studio-mobile-menu" onClick={() => setMobileMenuOpen((open) => !open)}>
            <span /><span /><span />
          </button>
        </div>

        {mobileMenuOpen && (
          <nav id="studio-mobile-menu" className="studio-mobile-menu" aria-label="Mobile navigation">
            <a href="#menu" onClick={closeMobileMenu}>Our menu</a>
            {highlights.length > 0 && <a href="#specials" onClick={closeMobileMenu}>Kitchen picks</a>}
            <Link href="/orders" onClick={closeMobileMenu}>Track order</Link>
            <Link href="/reservations" onClick={closeMobileMenu}>Reservations</Link>
            <a href="#contact" onClick={closeMobileMenu}>Contact &amp; location</a>
            <Link href="/admin" onClick={closeMobileMenu}>Staff portal</Link>
          </nav>
        )}
      </header>

      <section className="studio-hero">
        <div className="studio-hero-glow studio-hero-glow-one" />
        <div className="studio-hero-glow studio-hero-glow-two" />
        <div className="studio-hero-inner">
          <div className="studio-hero-copy">
            <div className="studio-location-badge">
              <span className="studio-badge-star">✦</span>
              <span>Authentic Lagos Firewood Kitchen</span>
              <span className="studio-badge-separator" />
              <span className="studio-badge-location">Lekki Phase 1</span>
            </div>
            <h1>Smoky Firewood Jollof, <span>Chargrilled Suya</span> &amp; Soulful Soups.</h1>
            <p className="studio-hero-description">Experience the heritage of genuine Nigerian firewood cooking. From tender slow-braised peppered Asun to rich Egusi with pounded yam, every meal is prepared fresh and delivered hot to your door.</p>
            <div className="studio-hero-actions">
              <a className="studio-button studio-button-primary" href="#menu">Order now <StudioIcon name="arrow" /></a>
              <Link className="studio-button studio-button-secondary" href="/orders"><StudioIcon name="search" /> Track an order</Link>
            </div>
            <div className="studio-hero-promises">
              <div className="studio-promise">
                <span className="studio-promise-icon"><StudioIcon name="flame" /></span>
                <span><strong>100% firewood</strong><small>Traditional smokiness</small></span>
              </div>
              <div className="studio-promise">
                <span className="studio-promise-icon"><StudioIcon name="shield" /></span>
                <span><strong>Paystack secured</strong><small>Instant verification</small></span>
              </div>
              <div className="studio-promise">
                <span className="studio-promise-icon"><StudioIcon name="pin" /></span>
                <span><strong>35–50 mins</strong><small>Lagos Island &amp; VI</small></span>
              </div>
            </div>
          </div>

          <div className="studio-hero-visual">
            <div className="studio-hero-frame">
              <div className="studio-hero-image-wrap">
                <img
                  src={featuredItem?.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=1200&q=80'}
                  alt={featuredItem?.name || 'A freshly prepared restaurant dish'}
                  className="studio-hero-image"
                  loading="eager"
                />
                <div className="studio-hero-image-shade" />
                <span className="studio-photo-tag"><span>✦</span> Made fresh over fire</span>
                <div className="studio-photo-caption">
                  <span>FROM OUR KITCHEN</span>
                  <strong>{featuredItem?.name || 'A meal worth sharing'}</strong>
                  {featuredItem && <b>{formatPrice(featuredItem.price_kobo)}</b>}
                </div>
              </div>
            </div>
            <div className="studio-hero-note">
              <span className="studio-hero-note-mark">✦</span>
              <span><strong>Good food, your way</strong><small>Choose a favourite and we’ll take it from there.</small></span>
            </div>
            <span className="studio-floating-star studio-floating-star-one">✦</span>
            <span className="studio-floating-star studio-floating-star-two">✳</span>
          </div>
        </div>
      </section>

      {highlights.length > 0 && (
        <section id="specials" className="studio-highlights" aria-labelledby="studio-highlights-title">
          <div className="studio-section-inner">
            <div className="studio-section-heading studio-highlights-heading">
              <div>
                <span className="studio-section-kicker"><span>✦</span> A FEW FROM OUR KITCHEN</span>
                <h2 id="studio-highlights-title">A taste of what’s cooking.</h2>
                <p>Start with one of these dishes, or explore the full menu below.</p>
              </div>
              <a href="#menu" className="studio-text-link">View the full menu <StudioIcon name="arrow" /></a>
            </div>
            <div className="studio-highlight-grid">
              {highlights.map((item, index) => (
                <article className="studio-highlight-card" key={item.id}>
                  <div className={'studio-highlight-image dish-tone-' + (index % 4)}>
                    {item.image_url ? <img src={item.image_url} alt={item.name} loading="lazy" /> : <span aria-hidden="true">{['✦', '●', '◆'][index]}</span>}
                    <span className="studio-highlight-tag"><StudioIcon name="flame" /> Kitchen pick</span>
                    <strong className="studio-highlight-price">{formatPrice(item.price_kobo)}</strong>
                  </div>
                  <div className="studio-highlight-copy">
                    <h3>{item.name}</h3>
                    <p>{item.description || 'A delicious choice from our kitchen.'}</p>
                    <button type="button" className="studio-highlight-add" onClick={() => add(item)}><span>＋</span> Add to your order</button>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      )}

      <section id="menu" className="studio-menu-section" aria-labelledby="studio-menu-title">
        <div className="studio-section-inner">
          <div className="studio-section-heading studio-menu-heading">
            <div>
              <span className="studio-section-kicker"><span>✦</span> HANDCRAFTED KITCHEN MENU</span>
              <h2 id="studio-menu-title">Explore our Nigerian delicacies.</h2>
              <p>Prepared to order using heritage recipes, hardwood smoke, and fresh ingredients.</p>
            </div>
            <div className="studio-menu-aside"><span className="studio-status-dot" /> Freshly prepared, made to order</div>
          </div>

          <div className="studio-menu-tools">
            <label className="studio-search">
              <StudioIcon name="search" />
              <span className="sr-only">Search dishes</span>
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search jollof, suya, soups..." />
              {search && <button type="button" aria-label="Clear search" onClick={() => setSearch('')}>×</button>}
            </label>
            <div className="studio-category-tabs" aria-label="Filter menu by category">
              <button type="button" aria-pressed={activeCategory === 'All'} className={activeCategory === 'All' ? 'is-active' : ''} onClick={() => setActiveCategory('All')}>Everything</button>
              {categories.map((category) => (
                <button type="button" key={category.id} aria-pressed={activeCategory === String(category.id)} className={activeCategory === String(category.id) ? 'is-active' : ''} onClick={() => setActiveCategory(String(category.id))}>{category.name}</button>
              ))}
            </div>
          </div>

          {!loading && !error && items.length > 0 && (
            <p className="studio-result-count" aria-live="polite"><span className="studio-result-dot" />{visibleItems.length} {visibleItems.length === 1 ? 'dish' : 'dishes'} on the menu</p>
          )}

          {notice && <p className="studio-notice" role="status">{notice}</p>}
          {error && (
            <div className="studio-menu-state" role="alert">
              <strong>Menu unavailable</strong><p>{error}</p>
              <button type="button" onClick={() => window.location.reload()}>Try again</button>
            </div>
          )}
          {loading && (
            <div className="studio-menu-grid" aria-label="Loading menu">
              {Array.from({ length: 6 }, (_, index) => <div className="studio-menu-card studio-skeleton" key={index}><div /><span /><span /></div>)}
            </div>
          )}
          {!loading && !error && visibleItems.length === 0 && (
            <div className="studio-menu-state">
              <strong>{items.length ? 'No dishes found' : 'The menu is being updated'}</strong>
              <p>{items.length ? 'Try a different search or category.' : 'Please check back soon.'}</p>
              {items.length > 0 && <button type="button" onClick={() => { setSearch(''); setActiveCategory('All'); }}>Reset filters</button>}
            </div>
          )}
          {!loading && !error && visibleItems.length > 0 && (
            <div className="studio-menu-grid">
              {visibleItems.map((item, index) => {
                const categoryName = categories.find((category) => category.id === item.category_id)?.name;
                const soldOut = item.stock_quantity === 0;
                return (
                  <article className="studio-menu-card" key={item.id}>
                    <div className={'studio-menu-image dish-tone-' + (index % 4)}>
                      {item.image_url ? <img src={item.image_url} alt={item.name} loading="lazy" /> : <span aria-hidden="true">{['✦', '●', '◆', '✺'][index % 4]}</span>}
                      <span className="studio-dish-category">{categoryName || 'From our kitchen'}</span>
                      {soldOut && <span className="studio-sold-out">Sold out</span>}
                    </div>
                    <div className="studio-menu-card-body">
                      <div className="studio-menu-card-copy">
                        <h3>{item.name}</h3>
                        <p>{item.description || 'A delicious choice from our kitchen.'}</p>
                      </div>
                      <div className="studio-menu-card-footer">
                        <strong>{formatPrice(item.price_kobo)}</strong>
                        <button type="button" className="studio-add-button" onClick={() => add(item)} disabled={soldOut} aria-label={soldOut ? item.name + ' is sold out' : 'Add ' + item.name + ' to your order'}>
                          {soldOut ? 'Sold out' : <>Add <span>＋</span></>}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="studio-difference">
        <div className="studio-section-inner">
          <div className="studio-difference-heading">
            <span className="studio-section-kicker"><span>✦</span> THE NAIJAGRILL DIFFERENCE</span>
            <h2>Authentic Nigerian soul, modern standards.</h2>
          </div>
          <div className="studio-difference-grid">
            <article><span className="studio-difference-icon"><StudioIcon name="flame" /></span><h3>Hardwood firewood flavour</h3><p>Smoky jollof and charcoal-grilled favourites, prepared fresh with the flavours of home.</p></article>
            <article><span className="studio-difference-icon"><StudioIcon name="bag" /></span><h3>Hot, careful delivery</h3><p>Orders are packed with care so every meal arrives ready to enjoy.</p></article>
            <article><span className="studio-difference-icon"><StudioIcon name="shield" /></span><h3>Secure Paystack checkout</h3><p>Payments are verified securely. Card details are never stored on our servers.</p></article>
            <article><span className="studio-difference-icon"><StudioIcon name="clock" /></span><h3>Order updates &amp; support</h3><p>Follow your order and get in touch with the restaurant when you need help.</p></article>
          </div>
        </div>
      </section>

      <footer id="contact" className="studio-footer">
        <div className="studio-section-inner">
          <div className="studio-footer-grid">
            <div className="studio-footer-brand">
              <Link href="/" className="studio-brand">
                {settings?.logoUrl ? <img className="studio-brand-logo" src={settings.logoUrl} alt="" /> : <span className="studio-brand-mark"><StudioIcon name="flame" /></span>}
                <span className="studio-brand-copy"><strong>{brandName}</strong><small>Kitchen &amp; Charcoal Bar</small></span>
              </Link>
              <p>Authentic Nigerian favourites, freshly prepared and ready for your table.</p>
              <span className="studio-footer-secure"><StudioIcon name="shield" /> Secure online checkout with Paystack</span>
            </div>

            <div className="studio-footer-column">
              <h3>Location</h3>
              {settings?.address ? <p className="studio-footer-detail"><StudioIcon name="pin" />{settings.address}</p> : <p className="studio-footer-muted">Contact us for our restaurant location.</p>}
              <Link href="/reservations">Reserve a table <StudioIcon name="arrow" /></Link>
            </div>

            <div className="studio-footer-column">
              <h3>Hours &amp; contact</h3>
              {settings?.openingHours && <p className="studio-footer-detail"><StudioIcon name="clock" />{settings.openingHours}</p>}
              {settings?.phone && <a className="studio-footer-detail" href={'tel:' + settings.phone}><span>☎</span>{settings.phone}</a>}
              {settings?.email && <a className="studio-footer-detail" href={'mailto:' + settings.email}><span>✉</span>{settings.email}</a>}
              {!settings?.openingHours && !settings?.phone && !settings?.email && <p className="studio-footer-muted">Reach us through your order or reservation.</p>}
            </div>

            <div className="studio-footer-column">
              <h3>Quick links</h3>
              <Link href="/orders">Track an order <StudioIcon name="arrow" /></Link>
              <Link href="/checkout">View your cart <StudioIcon name="arrow" /></Link>
              <Link href="/admin">Staff portal <StudioIcon name="arrow" /></Link>
                          </div>
          </div>
          <div className="studio-footer-bottom">
            <span>© {new Date().getFullYear()} {brandName}. All rights reserved.</span>
            <span>Fresh food, made with care.</span>
          </div>
        </div>
      </footer>

      {cartCount > 0 && (
        <Link href="/checkout" className="studio-mobile-cart" aria-label={'Checkout with ' + cartCount + ' ' + (cartCount === 1 ? 'item' : 'items') + ', total ' + formatPrice(cartTotal)}>
          <span className="studio-mobile-cart-copy"><strong>Your food bag</strong><small>{cartCount} {cartCount === 1 ? 'item' : 'items'}</small></span>
          <span className="studio-mobile-cart-total">{formatPrice(cartTotal)} <span aria-hidden="true">→</span></span>
        </Link>
      )}
    </main>
  );
}
