UPDATE users
SET phone = regexp_replace(regexp_replace(phone, '^\+?91', ''), '[^0-9]', '', 'g')
WHERE phone IS NOT NULL
  AND phone ~ '^\+?91[0-9]';

UPDATE addresses
SET phone = regexp_replace(regexp_replace(phone, '^\+?91', ''), '[^0-9]', '', 'g')
WHERE phone ~ '^\+?91[0-9]';

UPDATE orders
SET customer_phone = regexp_replace(regexp_replace(customer_phone, '^\+?91', ''), '[^0-9]', '', 'g')
WHERE customer_phone IS NOT NULL
  AND customer_phone ~ '^\+?91[0-9]';

UPDATE suppliers
SET phone = regexp_replace(regexp_replace(phone, '^\+?91', ''), '[^0-9]', '', 'g')
WHERE phone IS NOT NULL
  AND phone ~ '^\+?91[0-9]';

UPDATE quotations
SET consignee_phone = regexp_replace(regexp_replace(consignee_phone, '^\+?91', ''), '[^0-9]', '', 'g')
WHERE consignee_phone IS NOT NULL
  AND consignee_phone ~ '^\+?91[0-9]';


