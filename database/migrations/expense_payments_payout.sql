ALTER TABLE expense_payments ADD COLUMN IF NOT EXISTS payout_id TEXT;
ALTER TABLE expense_payments ADD COLUMN IF NOT EXISTS payout_status TEXT;

CREATE INDEX IF NOT EXISTS idx_expense_payments_payout_id ON expense_payments(payout_id);
