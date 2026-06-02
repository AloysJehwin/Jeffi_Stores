-- Wave 5+: Admin-controlled delivery & shipping rules

INSERT INTO site_settings (key, value, data_type, description) VALUES
  ('delivery_charges_enabled',     'true',  'boolean', 'Master toggle: TRUE charges shipping per Delhivery rates; FALSE makes all delivery free.'),
  ('delivery_free_threshold',      '5000',  'number',  'Subtotal (in INR) at or above which shipping is free, regardless of toggle. Set to 0 to disable.'),
  ('delivery_discount_percent',    '0',     'number',  'Percentage discount on the computed shipping charge (0-100).'),
  ('delivery_discount_flat',       '0',     'number',  'Flat INR discount on the computed shipping charge.'),
  ('delivery_discount_min_subtotal','0',    'number',  'Discounts apply only when cart subtotal is at/above this amount. 0 = always apply.'),
  ('delivery_discount_label',      '',      'string',  'Optional label shown on checkout when a discount is applied (e.g. "Holiday shipping discount").')
ON CONFLICT (key) DO NOTHING;

-- Migrate the legacy free_shipping_threshold key into delivery_free_threshold if present
UPDATE site_settings AS new
SET value = old.value
FROM site_settings AS old
WHERE new.key = 'delivery_free_threshold'
  AND old.key = 'free_shipping_threshold'
  AND new.value = '5000'
  AND old.value IS NOT NULL
  AND old.value <> '';

