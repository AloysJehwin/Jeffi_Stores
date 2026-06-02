-- Update campaign templates to include product images via {itemsHtml} (multi-item rows)
-- and {productCard} (single hero product card with image + price). Idempotent.

UPDATE campaigns SET
  subject_template = 'You left something in your cart, {firstName}',
  body_template = '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 12px;">Still thinking it over?</h2><p style="color:#555;line-height:1.6;margin:0 0 4px;">You left {itemCount} item(s) in your cart. We held onto them for you.</p>{itemsHtml}<p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Resume your order</a></p>',
  updated_at = NOW()
WHERE kind = 'abandoned_cart';

UPDATE campaigns SET
  subject_template = 'Complete your purchase, {firstName}',
  body_template = '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 12px;">Your cart is waiting</h2><p style="color:#555;line-height:1.6;margin:0 0 4px;">Order #{orderNumber} couldn''t be completed because payment didn''t go through in time. No worries — your items are still available.</p>{itemsHtml}<p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Try again</a></p>',
  updated_at = NOW()
WHERE kind = 'abandoned_checkout';

UPDATE campaigns SET
  subject_template = 'Hope you''re enjoying your purchase, {firstName}',
  body_template = '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 12px;">Thanks for shopping with us</h2><p style="color:#555;line-height:1.6;margin:0 0 4px;">Just checking in on your recent order #{orderNumber}. We hope everything arrived in great shape!</p>{itemsHtml}<p style="color:#555;line-height:1.6;margin:0 0 20px;">If anything''s not right, just reply to this email and we''ll sort it out.</p><p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">View your order</a></p>',
  updated_at = NOW()
WHERE kind = 'post_purchase';

UPDATE campaigns SET
  subject_template = 'How was your purchase, {firstName}?',
  body_template = '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 12px;">Mind sharing a quick review?</h2><p style="color:#555;line-height:1.6;margin:0 0 4px;">Your feedback on order #{orderNumber} would mean a lot. Tap any item below to leave a review (takes less than a minute).</p>{itemsHtml}<p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Leave a review</a></p>',
  updated_at = NOW()
WHERE kind = 'review_reminder';

UPDATE campaigns SET
  subject_template = 'We miss you, {firstName}',
  body_template = '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 12px;">It''s been a while</h2><p style="color:#555;line-height:1.6;margin:0 0 12px;">Here''s {discountPercent}% off your next order to welcome you back.</p><p style="background:#fff7ed;border:1px dashed #e07b3f;border-radius:6px;padding:14px 20px;text-align:center;margin:0 0 16px;font-family:ui-monospace,monospace;font-size:18px;color:#1a3a4a;font-weight:700;letter-spacing:1px;">{couponCode}</p><p style="color:#555;line-height:1.6;margin:0 0 4px;">Some of your past favorites:</p>{itemsHtml}<p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Browse products</a></p>',
  updated_at = NOW()
WHERE kind = 'winback_90';

UPDATE campaigns SET
  subject_template = 'Come back, {firstName} — {discountPercent}% off',
  body_template = '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 12px;">We''d love to have you back</h2><p style="color:#555;line-height:1.6;margin:0 0 12px;">Here''s {discountPercent}% off, just for you. Code expires in 14 days.</p><p style="background:#fff7ed;border:1px dashed #e07b3f;border-radius:6px;padding:14px 20px;text-align:center;margin:0 0 16px;font-family:ui-monospace,monospace;font-size:18px;color:#1a3a4a;font-weight:700;letter-spacing:1px;">{couponCode}</p><p style="color:#555;line-height:1.6;margin:0 0 4px;">Some of your past favorites:</p>{itemsHtml}<p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Shop now</a></p>',
  updated_at = NOW()
WHERE kind = 'winback_180';

UPDATE campaigns SET
  subject_template = '{productName} is back in stock!',
  body_template = '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 12px;">Good news!</h2><p style="color:#555;line-height:1.6;margin:0 0 4px;"><strong>{productName}</strong> from your wishlist is back in stock. Grab it before it''s gone again.</p>{productCard}<p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Buy now</a></p>',
  updated_at = NOW()
WHERE kind = 'restock';

UPDATE campaigns SET
  subject_template = 'Price drop on {productName}',
  body_template = '<p style="font-size:16px;color:#333;margin:0 0 12px;">Hi {firstName},</p><h2 style="font-size:22px;color:#1a3a4a;margin:0 0 12px;">Price just dropped</h2><p style="color:#555;line-height:1.6;margin:0 0 4px;"><strong>{productName}</strong> from your wishlist:</p>{productCard}<p style="margin:20px 0 0;"><a href="{ctaUrl}" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">View product</a></p>',
  updated_at = NOW()
WHERE kind = 'price_drop';


<<<<<<< HEAD

=======
>>>>>>> origin/main

