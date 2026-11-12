-- Starter templates per channel for email + SMS. Re-runnable: upsert on (system, slug).
--
-- WhatsApp rows were removed when Phase 0 shifted the WA catalog to the
-- {{1}} = brand convention. The authoritative WA catalog lives in
-- messaging-service/seed/catalog.ts (loaded via `pnpm --filter messaging-service seed:catalog`).
-- See messaging-service/scripts/backfill-legacy-wa-to-v2.ts for the one-shot
-- backfill that archives any remaining named-placeholder WA rows and clones
-- the v2 catalog bodies into tenants that still referenced them.
INSERT INTO public.message_templates (tenant_id, slug, channel, name, subject, body, variables) VALUES
  (NULL,'system/otp','email','One-time code','Your {{brand}} code: {{code}}','<p>Hi {{name}},</p><p>Your one-time code is <strong>{{code}}</strong>. It expires in {{minutes}} minutes.</p><p>— {{brand}}</p>','{brand,code,name,minutes}'),
  (NULL,'system/order-confirmation','email','Order confirmation','{{brand}}: order {{order_number}} confirmed','<p>Hi {{name}},</p><p>Thanks for your order <strong>{{order_number}}</strong> of {{total}}. We will let you know when it ships.</p><p>— {{brand}}</p>','{brand,name,order_number,total}'),
  (NULL,'system/promo-offer','email','Promotional offer','{{headline}}','<h2>{{headline}}</h2><p>{{body}}</p><p>Use code <strong>{{code}}</strong> before {{expires}}.</p><p><a href="{{url}}">Shop now</a></p>','{headline,body,code,expires,url}'),
  (NULL,'system/cart-reminder','email','Cart reminder','You left something behind at {{brand}}','<p>Hi {{name}},</p><p>Your cart with {{items}} items ({{total}}) is still waiting.</p><p><a href="{{url}}">Finish checkout</a></p>','{brand,name,items,total,url}'),
  (NULL,'system/newsletter','email','Newsletter','{{subject}}','<h1>{{headline}}</h1>{{body}}<p style="font-size:12px;color:#888">{{brand}} · <a href="{{unsubscribe_url}}">Unsubscribe</a></p>','{subject,headline,body,brand,unsubscribe_url}'),
  (NULL,'system/otp','sms','One-time code',NULL,'{{code}} is your {{brand}} code. Valid {{minutes}} min. Do not share it.','{code,brand,minutes}'),
  (NULL,'system/order-confirmation','sms','Order confirmation',NULL,'{{brand}}: order {{order_number}} confirmed for {{total}}. Track: {{url}}','{brand,order_number,total,url}'),
  (NULL,'system/promo-offer','sms','Promotional offer',NULL,'{{brand}}: {{headline}} Use {{code}} by {{expires}}. {{url}}','{brand,headline,code,expires,url}'),
  (NULL,'system/cart-reminder','sms','Cart reminder',NULL,'{{brand}}: your cart ({{total}}) is waiting. Finish checkout: {{url}}','{brand,total,url}'),
  (NULL,'system/delivery-update','sms','Delivery update',NULL,'{{brand}}: order {{order_number}} is {{status}}. {{url}}','{brand,order_number,status,url}')
ON CONFLICT (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), channel, slug) DO UPDATE SET
  name = EXCLUDED.name, subject = EXCLUDED.subject, body = EXCLUDED.body, variables = EXCLUDED.variables, updated_at = now();
