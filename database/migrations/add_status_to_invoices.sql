-- Add status column to invoices table to support draft (pre-processing) vs finalized invoices.
-- Draft rows are created at order placement (no invoice number yet).
-- Finalized rows are created when admin processes the order.
-- Default 'finalized' keeps all existing rows valid without a data migration.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'finalized'
    CHECK (status IN ('draft', 'finalized'));

-- Allow NULL for draft rows (no invoice number assigned yet at order placement)
ALTER TABLE invoices
  ALTER COLUMN invoice_number DROP NOT NULL,
  ALTER COLUMN financial_year DROP NOT NULL,
  ALTER COLUMN sequence_number DROP NOT NULL;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Index for the admin drafts query which joins invoices WHERE status = 'draft'
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices (status) WHERE status = 'draft';
