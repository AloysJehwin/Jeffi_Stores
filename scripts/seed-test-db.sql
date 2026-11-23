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
