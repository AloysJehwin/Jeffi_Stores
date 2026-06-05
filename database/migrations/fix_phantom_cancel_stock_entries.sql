-- Fix phantom stock entries: 'return' transactions logged for orders that never
-- reached 'processing', meaning stock was never deducted in the first place.
--
-- Root cause: cancel-review/route.ts was gating on payment_status='paid' instead
-- of checking for an actual sale transaction. A confirmed+paid order cancelled
-- before processing has no stock impact — but the old code restored it anyway.
--
-- Detection query (safe to re-run to verify fix is complete):
--   SELECT it.id, it.variant_id, it.quantity_change, o.status, o.payment_status
--   FROM inventory_transactions it
--   JOIN orders o ON o.id = it.reference_id
--   WHERE it.transaction_type = 'return'
--     AND it.reference_type = 'order'
--     AND NOT EXISTS (
--       SELECT 1 FROM inventory_transactions sale
--       WHERE sale.reference_id = it.reference_id AND sale.transaction_type = 'sale'
--     );
--
-- Run ONCE on live DB after deploying the code fix in:
--   src/app/api/orders/[id]/cancel-review/route.ts
--
-- Variant totals reversed:
--   4ad99d70  (Unbrako Hex Head Bolt Inch UNC Grade 8 1/2 - 1 1/2")    -21
--   2a166390  (Unbrako Socket Head Shoulder Screw M16(M12) - 10mm)      -6
--   f58b8e95  (unknown variant — confirmed+refunded, no sale record)     -2
--   08208c86  (BSW 1/2" SS 202 Allen Cap Screw - BSW 1/2" × 1.1/2")    -2
--   9b1fd0ff  (Unbrako Hex Head Bolt Inch UNC Grade 8 1 1/4 - 10mm)     -1
--   22a0e0e3  (Solar Aluminium End clamp - 30 x 50mm)                   -1

BEGIN;

UPDATE product_variants
SET inventory_quantity = inventory_quantity - 21, updated_at = NOW()
WHERE id = '4ad99d70-ea87-47aa-8526-94c61d3914e7';

UPDATE product_variants
SET inventory_quantity = inventory_quantity - 6, updated_at = NOW()
WHERE id = '2a166390-5ae8-4fab-b807-c208ac8712af';

UPDATE product_variants
SET inventory_quantity = inventory_quantity - 2, updated_at = NOW()
WHERE id = 'f58b8e95-173b-4081-a208-c9dd98f2beaf';

UPDATE product_variants
SET inventory_quantity = inventory_quantity - 2, updated_at = NOW()
WHERE id = '08208c86-0a13-473b-a23a-e1809f56fc0c';

UPDATE product_variants
SET inventory_quantity = inventory_quantity - 1, updated_at = NOW()
WHERE id = '9b1fd0ff-ee44-41e8-9413-6f22ee24c736';

UPDATE product_variants
SET inventory_quantity = inventory_quantity - 1, updated_at = NOW()
WHERE id = '22a0e0e3-ba78-41c2-beaa-45fed35c971f';

DELETE FROM inventory_transactions
WHERE id IN (
  -- variant 4ad99d70 (21 units)
  '3d5f4b1d-12b2-4d1f-b371-eabd0c504746',
  '2a32a8f0-ef4a-443b-9261-40f84b6d4a0e',
  '5d154bfa-3256-4aa7-a510-8f340c46ff5d',
  '7793d798-68e0-481d-98d9-452e7b5d8a93',
  '169590b8-db53-42cf-9370-33b72e1b03d2',
  'f3fa1210-0a83-467f-a45f-0229aba9fb99',
  '3ed2c4de-b43c-465a-aabd-8d8b61ddd23c',
  'ae71eecd-2b9c-409f-bb17-d84157bed4e0',
  '67bd66ee-fe5b-4859-9894-2be53ac976e4',
  -- variant 2a166390 (6 units)
  '6c81855f-f3a1-4a58-be50-c50c708a0cec',
  '670fae44-81c4-4b60-8202-8c1222c5f67c',
  '26245ba9-ade6-4a37-a322-4d570e1c8613',
  'ac96784f-a5bf-428b-a832-8e1abba14157',
  -- variant f58b8e95 (2 units)
  '06f23646-fa3f-4299-8d04-49798ec8fc26',
  'fa76ef1b-eca5-419e-a7c4-2e41cb2eb524',
  -- variant 08208c86 (2 units)
  '6eb9255d-f962-4a08-a4be-5427b988e003',
  'f4af1d3f-a2f4-49e0-bbfc-a302be083643',
  -- variant 9b1fd0ff (1 unit)
  'e8590b91-f75d-4332-93f7-3d4f7ca067f1',
  -- variant 22a0e0e3 (1 unit)
  '833c97b0-7a9b-441e-be60-8b93e8ad458e'
);

COMMIT;
