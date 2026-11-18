-- The messaging add-on now includes two numbers (customer-facing WhatsApp + SMS, admin-facing WhatsApp): ₹500/month,
-- cost ₹400 + 25%. Replaces any saved pricing so stores renew at the new price. Safe to run twice.
INSERT INTO public.platform_infra (key, value)
VALUES ('messaging_addon_pricing', '{"costLines":[{"label":"Customer-facing number (Twilio local, $1.15/month)","inrMonth":101.2},{"label":"Admin-facing number (Twilio local, $1.15/month)","inrMonth":101.2},{"label":"WhatsApp sender registration, upkeep and support","inrMonth":197.6}],"marginPct":25}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
