-- tenants.payment_required: the schema diff adds it, true (Mandatory) on every row. Stores approved while platform
-- payments were off (the removed ECOM_PAYMENTS_ENABLED) were built with no checkout, so they become Optional: past
-- review (started, live, suspended or closed) and never subscribed. Stores still in review keep Mandatory, as do
-- workspaces without a store. Flagship only (tenants is a control-plane table). Safe to run twice.
UPDATE public.tenants
   SET payment_required = false
 WHERE payment_required
   AND razorpay_subscription_id IS NULL
   AND 'store' = ANY(service_types)
   AND status NOT IN ('pending_approval', 'awaiting_payment', 'rejected');
