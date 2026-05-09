-- Phase 2: Financial Tracking
-- Add cost_price to products and variants for P&L gross margin calculation
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_price DECIMAL(12,2) DEFAULT 0;
ALTER TABLE product_variants ADD COLUMN IF NOT EXISTS cost_price DECIMAL(12,2) DEFAULT 0;

-- Supplier bills / payables (manually entered expense records)
CREATE TABLE IF NOT EXISTS expenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_number VARCHAR(50) UNIQUE NOT NULL,
  supplier_name VARCHAR(255) NOT NULL,
  supplier_gstin VARCHAR(20),
  description TEXT,
  amount DECIMAL(12,2) NOT NULL,
  tax_amount DECIMAL(12,2) DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL,
  expense_date DATE NOT NULL,
  due_date DATE,
  status VARCHAR(20) DEFAULT 'unpaid',  -- unpaid, paid, partial
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Payments recorded against expense bills
CREATE TABLE IF NOT EXISTS expense_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  expense_id UUID REFERENCES expenses(id) ON DELETE CASCADE,
  amount DECIMAL(12,2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method VARCHAR(50),
  reference VARCHAR(255),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(status);
CREATE INDEX IF NOT EXISTS idx_expenses_due_date ON expenses(due_date);
CREATE INDEX IF NOT EXISTS idx_expense_payments_expense_id ON expense_payments(expense_id);
