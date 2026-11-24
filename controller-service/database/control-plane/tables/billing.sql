--
-- Recurring charges on one Razorpay subscription per workspace (controller-service/src/lib/billing,
-- docs/plans/SUBSCRIPTION_BILLING_PLAN.md). A subscription's amount is the sum of its open lines; a change of
-- amount creates a replacement subscription (UPI and eMandate subscriptions reject updates). Entitlements stay on
-- tenants.ad_free_until / messaging_addon_until and showcase_sites.paid_until, written only by the billing handler.
--

-- One row per Razorpay subscription made by billing. is_current marks the one the workspace is billed on; a
-- replacement waiting for authorisation is not current until its subscription.authenticated.
CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
    id                       uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id                uuid NOT NULL,
    razorpay_subscription_id character varying(64) NOT NULL,
    razorpay_plan_id         character varying(64),
    mode                     character varying(4) NOT NULL DEFAULT 'live',      -- test|live: the key mode it was created with
    status                   character varying(16) NOT NULL DEFAULT 'created',  -- created|authenticated|active|pending|halted|paused|cancelled|completed|expired|superseded|abandoned
    is_current               boolean NOT NULL DEFAULT false,
    billing_interval         character varying(8) NOT NULL DEFAULT 'monthly',   -- monthly|yearly (yearly = 10× monthly)
    amount_paise             integer NOT NULL,                                   -- charged each cycle
    upfront_paise            integer NOT NULL DEFAULT 0,                         -- proration collected at authorisation
    lines                    jsonb NOT NULL DEFAULT '[]'::jsonb,                 -- [{kind, ref, label, amountPaise}] it charges for
    pending_change           jsonb,                                              -- applied when it takes effect: {plan, interval, spec, applyMode}
    payment_method           character varying(16),                              -- upi|card|emandate|nach, from Razorpay
    replaces_id              uuid,
    start_at                 timestamp with time zone,                           -- first charge, when not at authorisation
    current_start            timestamp with time zone,
    current_end              timestamp with time zone,
    grace_until              timestamp with time zone,                           -- halted: sites and add-ons stop after this
    last_event_at            timestamp with time zone,                           -- older webhook events don't move the status back
    checkout_url             text,
    created_at               timestamp with time zone NOT NULL DEFAULT now(),
    updated_at               timestamp with time zone NOT NULL DEFAULT now()
);

-- What a workspace is billed for. amount_paise is the monthly price at the time it was added (an admin price change
-- reaches it on the workspace's next change). legacy_wallet: paid from the wallet before the switch, until migrated.
CREATE TABLE IF NOT EXISTS public.billing_lines (
    id                       uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id                uuid NOT NULL,
    kind                     character varying(24) NOT NULL,                     -- store_plan|showcase_site|messaging_addon|ad_free
    ref                      character varying(64) NOT NULL DEFAULT '',          -- the site id (showcase_site), the tier (messaging_addon)
    amount_paise             integer NOT NULL,
    status                   character varying(16) NOT NULL DEFAULT 'awaiting_payment', -- trial|awaiting_payment|active|ending|legacy_wallet|ended
    subscription_id          uuid,                                               -- the billing subscription it was added on
    next_amount_paise        integer,                                            -- a lower price from changes_at (a store downgrade)
    changes_at               timestamp with time zone,
    trial_ends_at            timestamp with time zone,
    ends_at                  timestamp with time zone,
    grace_until              timestamp with time zone,
    legacy_ref               character varying(96),                              -- wallet_ledger external_ref of the open wallet-paid period
    last_notice              character varying(64),                              -- last reminder sent (the sweep's dedupe key)
    created_at               timestamp with time zone NOT NULL DEFAULT now(),
    updated_at               timestamp with time zone NOT NULL DEFAULT now()
);

-- One row per successful subscription charge (invoices, refunds of removed lines, admin revenue).
CREATE TABLE IF NOT EXISTS public.billing_charges (
    id                       uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id                uuid NOT NULL,
    subscription_id          uuid NOT NULL,
    razorpay_payment_id      character varying(64) NOT NULL,
    razorpay_invoice_id      character varying(64),
    amount_paise             integer NOT NULL,
    refunded_paise           integer NOT NULL DEFAULT 0,                         -- lines removed but still on an unapproved mandate
    lines                    jsonb NOT NULL DEFAULT '[]'::jsonb,
    period_start             timestamp with time zone,
    period_end               timestamp with time zone,
    charged_at               timestamp with time zone NOT NULL DEFAULT now()
);
