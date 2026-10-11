# Restaurant ordering app

A mobile-friendly restaurant storefront, order checkout, staff dashboard, PostgreSQL-backed menu and order API, and Paystack payment flow. The app uses Next.js 14 and runs locally in Google Cloud Shell or another Node.js environment.

## Requirements

- Node.js 20.19+ or 22.12+
- PostgreSQL 14+
- A Paystack account for payment testing or live checkout

## Local setup

To install dependencies, initialize the database, and start the development site in one step, run:

```bash
./start.sh
```

The script uses Node.js 20.19+, 22.12+, or newer; it reuses dependencies until `package-lock.json` changes, starts PostgreSQL 16 when the configured database is local and the cluster is stopped, applies the schema, and launches the development site. PostgreSQL 14+ is supported, though automatic cluster startup is specific to PostgreSQL 16 on Cloud Shell. If `.env.local` is missing, it creates one from `.env.example`; fill in its values and run the script again. The site starts on port 3000 by default. Choose another port with `./start.sh --port 3001` (or `./start.sh -p 8080`). Run `./start.sh --help` for options.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and set the values below.
3. Initialize the database with `npm run db:init`.
4. Start the app with `npm run dev` and open port 3000.

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
PAYSTACK_SECRET_KEY=your_paystack_test_or_live_secret
NEXT_PUBLIC_APP_URL=http://localhost:3000
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=use-a-unique-password-of-at-least-16-characters
ADMIN_SESSION_SECRET=use-a-random-secret-of-at-least-32-characters
```

Generate a session secret with `openssl rand -hex 32`. Keep `.env.local` private. Never put a Paystack secret or admin password in a `NEXT_PUBLIC_*` variable. The sample admin values are placeholders and are intentionally rejected by the login endpoint.

The database initializer creates menu categories and sample dishes. Edit or remove those products in the staff dashboard at `/admin` after signing in. Replace sample menu data, the generic restaurant name, and sample copy before opening to customers.

## Orders, receipts, and notifications

Customer receipts and tracking are available at `/order/{order-id}` after checkout. The receipt includes an order verification QR that opens a customer-facing verification page at `/verify/{order-id}`, and can be printed on A4 or 80 mm thermal paper. Staff can search and filter orders, update fulfillment status, review status history, and print receipts from `/admin`. Restaurant contact, opening-hours, delivery fee, delivery/pickup availability, logo, and receipt footer are configured in the dashboard.

Run `npm run db:init` on an existing database to apply the additive order-history, fulfillment, settings, notification-outbox, and admin-user schema changes. The first successful sign-in with the configured `ADMIN_EMAIL` and `ADMIN_PASSWORD` provisions the owner account. Change that password in the dashboard, then create separate staff accounts under **Staff accounts**. Passwords are stored as scrypt hashes. Purchased item names and prices are stored in each order's JSON snapshot, so later menu edits do not rewrite past receipts.

Order events enter a durable notification outbox. For Gmail delivery, set the server-only `GMAIL_USER`, `GMAIL_APP_PASSWORD`, and optional `GMAIL_FROM` values. Otherwise, configure the `EMAIL_PROVIDER_*`, `SMS_PROVIDER_*`, and `WHATSAPP_PROVIDER_*` values. Call `POST /api/internal/notifications` from a trusted scheduler with `Authorization: Bearer $NOTIFICATION_DISPATCH_TOKEN`. Provider URLs accept a JSON POST containing `to` and the order event payload. Validate delivery with your provider before production use.

### Telegram Mini App

The mobile order dashboard is available at `/telegram` and uses the existing admin login and order APIs. The Telegram bot also supports native inline cards for orders, payment checks, sales reports, menu items, and restaurant settings. Set `TELEGRAM_BOT_TOKEN` and a random `TELEGRAM_WEBHOOK_SECRET` (32+ characters) in the server's `.env.local`, ensure `NEXT_PUBLIC_APP_URL` is the public HTTPS origin, then run `node scripts/configure-telegram-bot.mjs` from the project directory. In the web dashboard, generate a Telegram link code and send `/link CODE` to the bot in a private chat. After linking, send `/start` to operate the bot. All bot actions require a linked admin account; staff account management remains owner-only.

## Payments

Use a Paystack test secret while developing. Checkout totals and item prices are recalculated from the database on the server. The payment callback is verified against the Paystack API and the order amount before an order is marked paid. Set `NEXT_PUBLIC_APP_URL` to the exact public origin in production and use HTTPS.

For reliable order updates when a customer closes the payment page before returning to the site, configure the Paystack webhook URL as `https://YOUR_DOMAIN/api/payments/webhook`. The webhook verifies Paystack’s HMAC signature before updating an order.

## Production notes

- Use a managed PostgreSQL service with automated backups and TLS.
- Admin sign-in is limited to five attempts per 15-minute window per proxy supplied `x-real-ip`; ensure the hosting proxy sets this header, and do not expose the app directly to untrusted clients.
- Configure a unique admin email, a strong password, and a dedicated random `ADMIN_SESSION_SECRET`.
- Store secrets in the hosting provider’s secret manager, not in source control.
- Set the production Paystack secret and public application URL.
- Configure logging, alerts, database backups, and request rate limiting at the hosting or edge layer.
- Review local tax, privacy, delivery, refund, and consumer disclosure requirements before taking live orders.
