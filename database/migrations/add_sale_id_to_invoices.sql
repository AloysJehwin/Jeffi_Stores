-- Allow cash_sales to register in invoices table so the sequence is shared
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS sale_id uuid REFERENCES cash_sales(id) ON DELETE CASCADE;

-- Backfill: link existing cash_sale invoice numbers to invoices table rows
-- (only for cash_sales that have an invoice_number not already in invoices)
INSERT INTO invoices (order_id, sale_id, invoice_number, financial_year, sequence_number)
SELECT NULL, cs.id, cs.invoice_number, cs.financial_year, cs.sequence_number
FROM cash_sales cs
WHERE cs.invoice_number IS NOT NULL
  AND cs.financial_year IS NOT NULL
  AND cs.sequence_number IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.invoice_number = cs.invoice_number)
ON CONFLICT (invoice_number) DO NOTHING;
