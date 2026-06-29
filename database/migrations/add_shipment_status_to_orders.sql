-- Add stable internal shipment status enum to orders table.
-- This decouples the timeline display from Delhivery's raw/stale statusType.
-- Values only move forward; never go backwards.

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS shipment_status TEXT
    CHECK (shipment_status IS NULL OR shipment_status IN (
      'created',
      'picked_up',
      'in_transit',
      'out_for_delivery',
      'delivery_attempted',
      'delivered',
      'rto_initiated',
      'rto_in_transit',
      'rto_out_for_return',
      'rto_delivered'
    ));

-- Backfill: orders that already have an AWB but no shipment_status yet
-- Map existing order status to the closest shipment_status
UPDATE orders SET shipment_status = CASE
  WHEN status = 'delivered'        THEN 'delivered'
  WHEN status = 'returned'         THEN 'rto_delivered'
  WHEN status = 'out_for_delivery' THEN 'out_for_delivery'
  WHEN status = 'shipped'          THEN 'in_transit'
  ELSE 'created'
END
WHERE awb_number IS NOT NULL
  AND shipment_status IS NULL;

COMMENT ON COLUMN orders.shipment_status IS
  'Stable internal shipment progress enum, resolved from Delhivery scan history. '
  'Set to created when AWB is assigned; updated on each track API call.';
