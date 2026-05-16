-- Search V2: FTS vectors + trigram indexes for all admin + storefront search surfaces

-- ─── Products: enrich search_vector with brand + category + description ───────
UPDATE products p
SET search_vector =
  setweight(to_tsvector('english', coalesce(p.name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(p.sku, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(b.name, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(p.short_description, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(p.description, '')), 'D')
FROM brands b
WHERE b.id = p.brand_id;

UPDATE products p
SET search_vector =
  setweight(to_tsvector('english', coalesce(p.name, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(p.sku, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(p.short_description, '')), 'C') ||
  setweight(to_tsvector('english', coalesce(p.description, '')), 'D')
WHERE brand_id IS NULL;

-- Auto-update trigger for products
CREATE OR REPLACE FUNCTION products_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.sku, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.short_description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'D');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS products_search_vector_trig ON products;
CREATE TRIGGER products_search_vector_trig
  BEFORE INSERT OR UPDATE OF name, sku, short_description, description
  ON products
  FOR EACH ROW EXECUTE FUNCTION products_search_vector_update();

-- ─── Orders: FTS vector ───────────────────────────────────────────────────────
ALTER TABLE orders ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE orders SET search_vector =
  setweight(to_tsvector('simple', coalesce(order_number, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(invoice_number, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(customer_name, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(customer_email, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(customer_phone, '')), 'B');

CREATE INDEX IF NOT EXISTS idx_orders_search_vector ON orders USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_orders_customer_name_trgm ON orders USING gin(customer_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_order_number_trgm ON orders USING gin(order_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_invoice_number_trgm ON orders USING gin(invoice_number gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_orders_customer_email_trgm ON orders USING gin(customer_email gin_trgm_ops);

CREATE OR REPLACE FUNCTION orders_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.order_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.invoice_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.customer_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.customer_email, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.customer_phone, '')), 'B');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS orders_search_vector_trig ON orders;
CREATE TRIGGER orders_search_vector_trig
  BEFORE INSERT OR UPDATE OF order_number, invoice_number, customer_name, customer_email, customer_phone
  ON orders
  FOR EACH ROW EXECUTE FUNCTION orders_search_vector_update();

-- ─── Quotations: FTS vector ───────────────────────────────────────────────────
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS search_vector tsvector;

UPDATE quotations SET search_vector =
  setweight(to_tsvector('simple', coalesce(quote_number, '')), 'A') ||
  setweight(to_tsvector('simple', coalesce(consignee_name, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(consignee_gstin, '')), 'B') ||
  setweight(to_tsvector('simple', coalesce(buyer_name, '')), 'C');

CREATE INDEX IF NOT EXISTS idx_quotations_search_vector ON quotations USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_quotations_consignee_name_trgm ON quotations USING gin(consignee_name gin_trgm_ops);

CREATE OR REPLACE FUNCTION quotations_search_vector_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.quote_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.consignee_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.consignee_gstin, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.buyer_name, '')), 'C');
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quotations_search_vector_trig ON quotations;
CREATE TRIGGER quotations_search_vector_trig
  BEFORE INSERT OR UPDATE OF quote_number, consignee_name, consignee_gstin, buyer_name
  ON quotations
  FOR EACH ROW EXECUTE FUNCTION quotations_search_vector_update();

-- ─── Suppliers: trgm indexes (small table, FTS overkill) ─────────────────────
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON suppliers USING gin(name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_gstin_trgm ON suppliers USING gin(gstin gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_suppliers_contact_name_trgm ON suppliers USING gin(contact_name gin_trgm_ops);

-- ─── Purchase Orders: trgm on po_number ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_po_number_trgm ON purchase_orders USING gin(po_number gin_trgm_ops);

-- ─── Users / Customers: trgm indexes ─────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email_trgm ON users USING gin(email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_phone_trgm ON users USING gin(phone gin_trgm_ops);
