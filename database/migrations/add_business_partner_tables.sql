-- Business Partner feature tables

-- 1. Mark users as business type
ALTER TABLE users ADD COLUMN IF NOT EXISTS user_type varchar(20) NOT NULL DEFAULT 'customer';

-- 2. Business profile (one per business user, requires admin approval)
CREATE TABLE IF NOT EXISTS business_profiles (
  id               uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  company_name     text NOT NULL,
  gst_number       text NOT NULL,
  business_address text NOT NULL,
  industry         text NOT NULL,
  approval_status  varchar(20) NOT NULL DEFAULT 'pending',
  approved_by      uuid REFERENCES admins(id),
  approved_at      timestamptz,
  rejection_note   text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
CREATE INDEX IF NOT EXISTS idx_business_profiles_user_id ON business_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_business_profiles_approval_status ON business_profiles(approval_status);

-- 3. Per-user per-category discounts (applied on top of existing product price)
CREATE TABLE IF NOT EXISTS business_discounts (
  id           uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  discount_pct numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount_pct >= 0 AND discount_pct <= 100),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, category_id)
);
CREATE INDEX IF NOT EXISTS idx_business_discounts_user_id ON business_discounts(user_id);

-- 4. Business RFQs (quote requests submitted from business portal)
CREATE TABLE IF NOT EXISTS business_rfqs (
  id                      uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  rfq_number              text NOT NULL UNIQUE,
  user_id                 uuid NOT NULL REFERENCES users(id),
  status                  varchar(20) NOT NULL DEFAULT 'pending',
  notes                   text,
  converted_quotation_id  uuid REFERENCES quotations(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_rfqs_user_id ON business_rfqs(user_id);
CREATE INDEX IF NOT EXISTS idx_business_rfqs_status ON business_rfqs(status);

-- 5. Business RFQ line items
CREATE TABLE IF NOT EXISTS business_rfq_items (
  id          uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  rfq_id      uuid NOT NULL REFERENCES business_rfqs(id) ON DELETE CASCADE,
  product_id  uuid REFERENCES products(id),
  variant_id  uuid REFERENCES product_variants(id),
  description text NOT NULL,
  quantity    integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit        text NOT NULL DEFAULT 'Nos',
  notes       text,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_business_rfq_items_rfq_id ON business_rfq_items(rfq_id);
