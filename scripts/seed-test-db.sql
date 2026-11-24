-- Self-contained fixtures for DB-backed API tests. LOCAL/CI jeffi_test ONLY.
-- Fixed uuids so tests can reference rows directly. Idempotent (ON CONFLICT DO NOTHING).
-- Per-file tests seed their OWN mutable rows; this provides stable shared read fixtures
-- (a customer, an admin user + admins row, a couple of active products).

-- Customer (read fixture; tests needing a customer session reference this id)
INSERT INTO users (id, email, first_name, last_name, user_type)
VALUES ('00000000-0000-4000-a000-0000000000c1', 'apitest-customer@jeffi.test', 'API', 'Customer', 'customer')
ON CONFLICT (id) DO NOTHING;

-- Admin: a user row + an admins row (admins.user_id -> users.id), full scopes.
INSERT INTO users (id, email, first_name, last_name, user_type)
VALUES ('00000000-0000-4000-a000-0000000000a0', 'apitest-admin@jeffi.test', 'API', 'Admin', 'customer')
ON CONFLICT (id) DO NOTHING;
INSERT INTO admins (id, user_id, role, scopes, is_active)
VALUES ('00000000-0000-4000-a000-0000000000a1', '00000000-0000-4000-a000-0000000000a0', 'administrator', '["*"]'::jsonb, true)
ON CONFLICT (id) DO NOTHING;

-- Active products (read fixtures for catalog/cart/wishlist API tests)
INSERT INTO products (id, sku, name, slug, base_price, inventory_quantity, is_active, stock_status)
VALUES
  ('00000000-0000-4000-b000-000000000001', 'APITEST-SKU-1', 'API Test Bolt', 'api-test-bolt', 100.00, 50, true, 'In Stock'),
  ('00000000-0000-4000-b000-000000000002', 'APITEST-SKU-2', 'API Test Nut', 'api-test-nut', 25.50, 200, true, 'In Stock')
ON CONFLICT (id) DO NOTHING;

-- Browser UI tests (tests/ui-kit/session.ts): an approved business account, and a paused Showcase site.
INSERT INTO users (id, email, first_name, last_name, user_type)
VALUES ('00000000-0000-4000-a000-0000000000d1', 'uitest-business@jeffi.test', 'UI', 'Business', 'business')
ON CONFLICT (id) DO NOTHING;
INSERT INTO business_profiles (id, user_id, company_name, gst_number, business_address, industry, approval_status)
VALUES ('00000000-0000-4000-a000-0000000000d2', '00000000-0000-4000-a000-0000000000d1', 'UI Test Traders', '27AAAAA0000A1Z5', '1 Test Road, Pune', 'Retail', 'approved')
ON CONFLICT (id) DO NOTHING;

INSERT INTO owners (id, email, name)
VALUES ('00000000-0000-4000-a000-0000000000e1', 'uitest-owner@jeffi.test', 'UI Owner')
ON CONFLICT (id) DO NOTHING;
-- Paused: the page draws the business name and a note with no compiled page document.
INSERT INTO showcase_sites (id, owner_id, slug, status, pause_reason, business)
VALUES ('00000000-0000-4000-a000-0000000000f1', '00000000-0000-4000-a000-0000000000e1', 'ui-test-studio', 'paused', 'owner', '{"name":"UI Test Studio"}'::jsonb)
ON CONFLICT (id) DO NOTHING;
