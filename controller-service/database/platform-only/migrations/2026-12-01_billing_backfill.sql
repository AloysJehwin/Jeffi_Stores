-- Recurring charges move onto one Razorpay subscription per workspace (docs/plans/SUBSCRIPTION_BILLING_PLAN.md).
-- Cutover: no recurring wallet debit after this (the renew crons are gone). Existing store subscriptions become
-- billing subscriptions (and route through razorpay_subscription_index), wallet-paid add-ons and Showcase sites get
-- legacy_wallet lines that keep working until GREATEST(paid_until + 7d, cutover + 14d), and sites still in their old
-- free month keep it as a trial. Flagship only (control-plane tables). Safe to run twice.

INSERT INTO public.platform_infra (key, value) VALUES ('billing_mode', 'subscription') ON CONFLICT (key) DO NOTHING;
INSERT INTO public.platform_infra (key, value) VALUES ('billing_cutover_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
ON CONFLICT (key) DO NOTHING;

-- Store plan subscriptions.
INSERT INTO public.billing_subscriptions
    (tenant_id, razorpay_subscription_id, status, is_current, billing_interval, amount_paise, lines, checkout_url)
SELECT t.id, t.razorpay_subscription_id,
       CASE t.subscription_status WHEN 'halted' THEN 'halted' WHEN 'authenticated' THEN 'authenticated' WHEN 'active' THEN 'active' ELSE 'created' END,
       true,
       COALESCE(t.billing_interval, 'monthly'),
       (round(COALESCE(c.price_inr_month, p.monthly_price_inr, 0) * 100) * CASE WHEN t.billing_interval = 'yearly' THEN 10 ELSE 1 END)::int,
       jsonb_build_array(jsonb_build_object('kind', 'store_plan', 'ref', '', 'label', COALESCE(p.name, 'Store') || ' plan',
                         'amountPaise', round(COALESCE(c.price_inr_month, p.monthly_price_inr, 0) * 100)::int)),
       t.razorpay_checkout_url
  FROM public.tenants t
  LEFT JOIN public.plans p ON p.id = t.plan_id
  LEFT JOIN public.tenant_compute c ON c.tenant_id = t.id
 WHERE t.razorpay_subscription_id IS NOT NULL
   AND t.subscription_status IN ('created', 'authenticated', 'active', 'halted')
   AND NOT EXISTS (SELECT 1 FROM public.billing_subscriptions b WHERE b.tenant_id = t.id AND b.is_current)
ON CONFLICT (razorpay_subscription_id) DO NOTHING;

INSERT INTO public.razorpay_subscription_index (razorpay_subscription_id, tenant_id, collecting_account, local_subscription_id)
SELECT b.razorpay_subscription_id, b.tenant_id, 'billing', b.id FROM public.billing_subscriptions b
ON CONFLICT (razorpay_subscription_id) DO NOTHING;

INSERT INTO public.billing_lines (tenant_id, kind, ref, amount_paise, status, subscription_id)
SELECT b.tenant_id, 'store_plan', '', (b.lines -> 0 ->> 'amountPaise')::int,
       CASE WHEN b.status = 'created' THEN 'awaiting_payment' ELSE 'active' END, b.id
  FROM public.billing_subscriptions b
 WHERE b.is_current AND b.lines -> 0 ->> 'kind' = 'store_plan'
ON CONFLICT (tenant_id, kind, ref) WHERE status <> 'ended' DO NOTHING;

-- Ad-free months paid from the wallet.
INSERT INTO public.billing_lines (tenant_id, kind, ref, amount_paise, status, grace_until, legacy_ref)
SELECT t.id, 'ad_free', '', COALESCE(round(-w.amount * 100)::int, 50000), 'legacy_wallet',
       GREATEST(t.ad_free_until + interval '7 days', now() + interval '14 days'), w.external_ref
  FROM public.tenants t
  LEFT JOIN LATERAL (SELECT l.amount, l.external_ref FROM public.wallet_ledger l
                      WHERE l.tenant_id = t.id AND l.entry_type = 'debit' AND l.external_ref LIKE 'ad_free:' || t.id || ':%'
                      ORDER BY l.occurred_at DESC LIMIT 1) w ON true
 WHERE t.ad_free_until > now()
ON CONFLICT (tenant_id, kind, ref) WHERE status <> 'ended' DO NOTHING;

-- SMS & WhatsApp months paid from the wallet.
INSERT INTO public.billing_lines (tenant_id, kind, ref, amount_paise, status, grace_until, legacy_ref)
SELECT t.id, 'messaging_addon', t.messaging_addon, COALESCE(round(-w.amount * 100)::int, 50000), 'legacy_wallet',
       GREATEST(t.messaging_addon_until + interval '7 days', now() + interval '14 days'), w.external_ref
  FROM public.tenants t
  LEFT JOIN LATERAL (SELECT l.amount, l.external_ref FROM public.wallet_ledger l
                      WHERE l.tenant_id = t.id AND l.entry_type = 'debit' AND l.external_ref LIKE 'messaging_addon:' || t.id || ':%'
                      ORDER BY l.occurred_at DESC LIMIT 1) w ON true
 WHERE t.messaging_addon_until > now() AND t.messaging_addon IN ('sms', 'whatsapp', 'both')
ON CONFLICT (tenant_id, kind, ref) WHERE status <> 'ended' DO NOTHING;

-- Showcase: a site never charged is still in its old free month and keeps it as a trial (decision 3).
UPDATE public.showcase_sites s
   SET trial_ends_at = CASE
         WHEN NOT EXISTS (SELECT 1 FROM public.wallet_ledger l WHERE l.tenant_id = s.tenant_id AND l.external_ref LIKE 'showcase:' || s.id || ':%')
           THEN s.paid_until
         ELSE s.published_at + interval '30 days' END
 WHERE s.trial_ends_at IS NULL AND s.published_at IS NOT NULL AND s.paid_until IS NOT NULL;

INSERT INTO public.billing_lines (tenant_id, kind, ref, amount_paise, status, trial_ends_at)
SELECT s.tenant_id, 'showcase_site', s.id::text, 20000, 'trial', s.trial_ends_at
  FROM public.showcase_sites s
 WHERE s.tenant_id IS NOT NULL AND s.status <> 'draft' AND s.trial_ends_at = s.paid_until AND s.paid_until > now()
   AND NOT EXISTS (SELECT 1 FROM public.wallet_ledger l WHERE l.tenant_id = s.tenant_id AND l.external_ref LIKE 'showcase:' || s.id || ':%')
ON CONFLICT (tenant_id, kind, ref) WHERE status <> 'ended' DO NOTHING;

-- Wallet-paid sites still online (paid, or in the old grace week).
INSERT INTO public.billing_lines (tenant_id, kind, ref, amount_paise, status, grace_until, legacy_ref)
SELECT s.tenant_id, 'showcase_site', s.id::text, COALESCE(round(-w.amount * 100)::int, 20000), 'legacy_wallet',
       GREATEST(s.paid_until + interval '7 days', now() + interval '14 days'), w.external_ref
  FROM public.showcase_sites s
  JOIN LATERAL (SELECT l.amount, l.external_ref FROM public.wallet_ledger l
                 WHERE l.tenant_id = s.tenant_id AND l.entry_type = 'debit' AND l.external_ref LIKE 'showcase:' || s.id || ':%'
                 ORDER BY l.occurred_at DESC LIMIT 1) w ON true
 WHERE s.tenant_id IS NOT NULL AND s.paid_until IS NOT NULL
   AND (s.paid_until > now() OR s.status = 'live')
ON CONFLICT (tenant_id, kind, ref) WHERE status <> 'ended' DO NOTHING;
