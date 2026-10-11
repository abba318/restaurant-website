CREATE TABLE IF NOT EXISTS categories(
 id SERIAL PRIMARY KEY,
 name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS menu_items(
 id SERIAL PRIMARY KEY,
 category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
 name TEXT NOT NULL,
 description TEXT DEFAULT '',
 price_kobo INTEGER NOT NULL CHECK(price_kobo>=0),
 image_url TEXT DEFAULT '',
 available BOOLEAN NOT NULL DEFAULT TRUE,
 stock_quantity INTEGER,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS stock_quantity INTEGER;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='menu_items_stock_quantity_check') THEN
  ALTER TABLE menu_items ADD CONSTRAINT menu_items_stock_quantity_check CHECK(stock_quantity IS NULL OR (stock_quantity>=0 AND stock_quantity<=1000000));
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS orders(
 id UUID PRIMARY KEY,
 customer_name TEXT NOT NULL,
 customer_email TEXT NOT NULL,
 customer_phone TEXT DEFAULT '',
 delivery_address TEXT DEFAULT '',
 items JSONB NOT NULL,
 total_kobo INTEGER NOT NULL CHECK(total_kobo>=0),
 status TEXT NOT NULL DEFAULT 'pending',
 payment_reference TEXT,
 payment_status TEXT NOT NULL DEFAULT 'unpaid',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Additive upgrades: order item JSON stores the name and price at purchase time.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fulfillment_type TEXT NOT NULL DEFAULT 'delivery';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee_kobo INTEGER NOT NULL DEFAULT 0 CHECK(delivery_fee_kobo>=0);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_instructions TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_verified_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS device_id UUID;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_latitude DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS location_longitude DOUBLE PRECISION;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_notification_queued_at TIMESTAMPTZ;
UPDATE orders SET paid_notification_queued_at=NOW() WHERE payment_status='paid' AND paid_notification_queued_at IS NULL;
CREATE TABLE IF NOT EXISTS order_status_history(
 id BIGSERIAL PRIMARY KEY,
 order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 status TEXT NOT NULL,
 changed_by TEXT NOT NULL,
 changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO order_status_history(order_id,status,changed_by)
 SELECT id,status,'system' FROM orders WHERE NOT EXISTS(SELECT 1 FROM order_status_history h WHERE h.order_id=orders.id);
CREATE TABLE IF NOT EXISTS reservations(
 id BIGSERIAL PRIMARY KEY,
 customer_name TEXT NOT NULL,
 customer_email TEXT NOT NULL,
 customer_phone TEXT NOT NULL,
 reservation_date DATE NOT NULL,
 reservation_time TIME NOT NULL,
 party_size INTEGER NOT NULL CHECK(party_size BETWEEN 1 AND 20),
 notes TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','cancelled','completed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS reservations_date_time_idx ON reservations(reservation_date,reservation_time);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS reservation_fee_kobo INTEGER NOT NULL DEFAULT 0 CHECK(reservation_fee_kobo>=0 AND reservation_fee_kobo<=100000000);
CREATE TABLE IF NOT EXISTS restaurant_settings(
 id INTEGER PRIMARY KEY DEFAULT 1 CHECK(id=1),
 settings JSONB NOT NULL DEFAULT '{}'::jsonb,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO restaurant_settings(id,settings) VALUES(1,'{"name":"Restaurant","currency":"NGN","deliveryEnabled":true,"pickupEnabled":true,"deliveryFeeKobo":0,"reservationFree":true,"reservationFeeKobo":0,"address":"","phone":"","email":"","logoUrl":"","openingHours":"","receiptFooter":"Thank you for your order."}'::jsonb) ON CONFLICT(id) DO NOTHING;
UPDATE restaurant_settings SET settings=settings || '{"reservationFree":true,"reservationFeeKobo":0}'::jsonb WHERE NOT (settings ? 'reservationFree') OR NOT (settings ? 'reservationFeeKobo');
CREATE TABLE IF NOT EXISTS notification_outbox(
 id BIGSERIAL PRIMARY KEY,
 order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
 channel TEXT NOT NULL CHECK(channel IN ('email','sms','whatsapp')),
 destination TEXT NOT NULL,
 payload JSONB NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','sent','failed')),
 attempts INTEGER NOT NULL DEFAULT 0,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 sent_at TIMESTAMPTZ
);
ALTER TABLE notification_outbox ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE notification_outbox ADD COLUMN IF NOT EXISTS reservation_id BIGINT REFERENCES reservations(id) ON DELETE CASCADE;
ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_reference_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_reference_check CHECK ((order_id IS NOT NULL)::int + (reservation_id IS NOT NULL)::int = 1);
ALTER TABLE notification_outbox DROP CONSTRAINT IF EXISTS notification_outbox_channel_check;
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_channel_check CHECK(channel IN ('email','sms','whatsapp','telegram'));
UPDATE notification_outbox n SET state='failed' FROM orders o WHERE n.order_id=o.id AND n.state='pending' AND o.payment_status<>'paid';
CREATE INDEX IF NOT EXISTS notification_outbox_pending_idx ON notification_outbox(state,created_at);
CREATE TABLE IF NOT EXISTS admin_login_attempts(
 ip_hash CHAR(64) PRIMARY KEY,
 attempts INTEGER NOT NULL CHECK(attempts>=0),
 window_started_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_users(
 id BIGSERIAL PRIMARY KEY,
 email TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'staff' CHECK(role IN ('owner','staff','kitchen')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check CHECK(role IN ('owner','staff','kitchen'));
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS telegram_user_id TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS telegram_link_code_hash TEXT;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS telegram_link_expires_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_telegram_user_idx ON admin_users(telegram_user_id) WHERE telegram_user_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS telegram_bot_sessions(
 telegram_user_id TEXT PRIMARY KEY,
 state JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_login_attempts_window_idx ON admin_login_attempts(window_started_at);
CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status);
CREATE INDEX IF NOT EXISTS orders_device_created_idx ON orders(device_id,created_at DESC) WHERE device_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS order_status_history_order_idx ON order_status_history(order_id,changed_at);
INSERT INTO categories(name) VALUES('Main Meals'),('Drinks'),('Snacks') ON CONFLICT(name) DO NOTHING;
INSERT INTO menu_items(category_id,name,description,price_kobo)
SELECT id,'Jollof Rice & Chicken','Classic jollof rice with chicken',350000 FROM categories WHERE name='Main Meals'
AND NOT EXISTS(SELECT 1 FROM menu_items WHERE name='Jollof Rice & Chicken');
INSERT INTO menu_items(category_id,name,description,price_kobo)
SELECT id,'Fried Rice & Chicken','Fried rice with chicken',400000 FROM categories WHERE name='Main Meals'
AND NOT EXISTS(SELECT 1 FROM menu_items WHERE name='Fried Rice & Chicken');
INSERT INTO menu_items(category_id,name,description,price_kobo)
SELECT id,'Bottled Water','Chilled bottled water',100000 FROM categories WHERE name='Drinks'
AND NOT EXISTS(SELECT 1 FROM menu_items WHERE name='Bottled Water');
INSERT INTO menu_items(category_id,name,description,price_kobo)
SELECT id,'Chicken Samosa','Crisp pastry filled with spiced chicken and vegetables',50000 FROM categories WHERE name='Snacks'
AND NOT EXISTS(SELECT 1 FROM menu_items WHERE name='Chicken Samosa');
UPDATE menu_items SET name='Chicken Samosa',description='Crisp pastry filled with spiced chicken and vegetables'
WHERE name='Small Product';
