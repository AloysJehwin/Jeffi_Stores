-- Backfill order_items.mrp from quotation_items.rate for orders created from quotations
-- where mrp was not populated (orders created before the mrp fix).

UPDATE order_items oi
SET mrp = qi.rate
FROM quotations q
JOIN quotation_items qi ON qi.quotation_id = q.id
WHERE q.converted_order_id = oi.order_id
  AND qi.product_id = oi.product_id
  AND COALESCE(qi.variant_id::text, '')      = COALESCE(oi.variant_id::text, '')
  AND COALESCE(qi.sub_variant_id::text, '')  = COALESCE(oi.sub_variant_id::text, '')
  AND oi.mrp IS NULL
  AND qi.rate > 0;
