-- Allow inventory columns to store fractional quantities
-- Required for selling units like metres, kg, ft², litres, pairs, etc.

ALTER TABLE products
  ALTER COLUMN inventory_quantity TYPE NUMERIC(14,3) USING inventory_quantity::NUMERIC(14,3);

ALTER TABLE product_variants
  ALTER COLUMN inventory_quantity TYPE NUMERIC(14,3) USING inventory_quantity::NUMERIC(14,3);

ALTER TABLE product_sub_variants
  ALTER COLUMN stock_quantity TYPE NUMERIC(14,3) USING stock_quantity::NUMERIC(14,3),
  ALTER COLUMN inventory_quantity TYPE NUMERIC(14,3) USING COALESCE(inventory_quantity, stock_quantity)::NUMERIC(14,3);

ALTER TABLE inventory_transactions
  ALTER COLUMN quantity_change TYPE NUMERIC(14,3) USING quantity_change::NUMERIC(14,3),
  ALTER COLUMN quantity_after  TYPE NUMERIC(14,3) USING quantity_after::NUMERIC(14,3);

-- Purchase order and GRN quantity columns also need fractional support
ALTER TABLE purchase_order_items
  ALTER COLUMN quantity TYPE NUMERIC(14,3) USING quantity::NUMERIC(14,3);

ALTER TABLE grn_items
  ALTER COLUMN quantity_received TYPE NUMERIC(14,3) USING quantity_received::NUMERIC(14,3);
