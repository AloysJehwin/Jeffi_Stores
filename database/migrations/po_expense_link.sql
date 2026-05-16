ALTER TABLE expenses ADD COLUMN IF NOT EXISTS po_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS grn_id UUID REFERENCES grns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_po_id ON expenses(po_id);
CREATE INDEX IF NOT EXISTS idx_expenses_grn_id ON expenses(grn_id);
