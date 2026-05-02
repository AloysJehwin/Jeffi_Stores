CREATE TABLE IF NOT EXISTS quotations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quote_number     VARCHAR(60) NOT NULL UNIQUE,
  quote_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  status           VARCHAR(20) NOT NULL DEFAULT 'draft',
  consignee_name   TEXT,
  consignee_addr1  TEXT,
  consignee_addr2  TEXT,
  consignee_city   TEXT,
  consignee_state  TEXT DEFAULT 'Chhattisgarh',
  consignee_gstin  TEXT,
  buyer_same       BOOLEAN NOT NULL DEFAULT true,
  buyer_name       TEXT,
  buyer_addr1      TEXT,
  buyer_addr2      TEXT,
  buyer_city       TEXT,
  buyer_state      TEXT DEFAULT 'Chhattisgarh',
  buyer_gstin      TEXT,
  notes            TEXT,
  subtotal         NUMERIC(12,4) DEFAULT 0,
  cgst_amount      NUMERIC(12,4) DEFAULT 0,
  sgst_amount      NUMERIC(12,4) DEFAULT 0,
  total_amount     NUMERIC(12,4) DEFAULT 0,
  created_by       UUID REFERENCES admins(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS quotation_items (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  quotation_id     UUID NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  position         INTEGER NOT NULL DEFAULT 0,
  description      TEXT NOT NULL,
  hsn_code         VARCHAR(20),
  gst_rate         NUMERIC(5,2) NOT NULL DEFAULT 18,
  quantity         NUMERIC(12,3) NOT NULL,
  unit             VARCHAR(20) NOT NULL DEFAULT 'PCS',
  rate             NUMERIC(12,4) NOT NULL,
  discount_pct     NUMERIC(5,2) DEFAULT 0,
  amount           NUMERIC(12,4) NOT NULL,
  product_id       UUID REFERENCES products(id) ON DELETE SET NULL,
  variant_id       UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quotations_status ON quotations(status);
CREATE INDEX IF NOT EXISTS idx_quotations_quote_date ON quotations(quote_date);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation_id ON quotation_items(quotation_id);
