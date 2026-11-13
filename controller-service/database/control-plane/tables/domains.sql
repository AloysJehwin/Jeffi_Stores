--
-- Domains a store owner buys through the platform (Route 53 Domains, paid yearly from the wallet).
-- The row is the registration job: charge → RegisterDomain → poll the operation → DNS, routes and
-- certificates (lib/domains/orders.ts). Prices are snapshotted at purchase: AWS cost in USD, the rate
-- and margin used, and what the wallet was charged.
--
CREATE TABLE IF NOT EXISTS public.tenant_domain_orders (
    id               uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id        uuid NOT NULL,
    domain           character varying(253) NOT NULL,
    status           character varying(16) NOT NULL DEFAULT 'requested', -- requested|registering|configuring|active|failed|cancelled|expired
    step             character varying(16),                -- in-flight work: charge|register|zone|records|routing|certs
    source           character varying(16) NOT NULL DEFAULT 'dashboard', -- dashboard|onboarding
    contact          jsonb NOT NULL,                       -- registrant contact sent to RegisterDomain (privacy protection on)
    cost_usd         numeric(10,2) NOT NULL,               -- AWS registration price, first year
    renewal_cost_usd numeric(10,2),                        -- AWS renewal price when bought
    usd_inr          numeric(8,2) NOT NULL,
    margin           numeric(6,4) NOT NULL,
    price_inr        integer NOT NULL,                     -- first year, charged to the wallet
    charge_ref       character varying(64),                -- wallet_ledger external_ref of the first-year charge
    refunded_inr     integer,
    operation_id     character varying(64),                -- RegisterDomain operation (GetOperationDetail)
    hosted_zone_id   character varying(64),
    auto_renew       boolean NOT NULL DEFAULT true,
    contact_verified boolean NOT NULL DEFAULT false,       -- registrant email confirmed; registries suspend unconfirmed domains after 15 days
    registered_at    timestamp with time zone,
    expires_at       timestamp with time zone,
    attempts         integer NOT NULL DEFAULT 0,
    next_at          timestamp with time zone,             -- lease / backoff: the job is not advanced before this
    last_error       text,
    events           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- progress shown to the owner: [{at, step, message, level}]
    created_at       timestamp with time zone NOT NULL DEFAULT now(),
    updated_at       timestamp with time zone NOT NULL DEFAULT now()
);

--
-- One row per yearly renewal of a bought domain (lib/domains/renewal.ts). The wallet is debited first;
-- RenewDomain is called only after the debit succeeds. AWS auto-renew is off, so nothing renews at the
-- platform's cost.
--
CREATE TABLE IF NOT EXISTS public.tenant_domain_renewals (
    id              uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id        uuid NOT NULL,
    tenant_id       uuid NOT NULL,
    term_expires_at timestamp with time zone NOT NULL,    -- the expiry this renewal extends by a year
    status          character varying(16) NOT NULL DEFAULT 'due', -- due|renewing|done|lapsed|off
    cost_usd        numeric(10,2),
    usd_inr         numeric(8,2),
    margin          numeric(6,4),
    price_inr       integer,
    charge_ref      character varying(64),
    operation_id    character varying(64),
    attempts        integer NOT NULL DEFAULT 0,
    next_at         timestamp with time zone,
    notified_at     timestamp with time zone,             -- last reminder / short-wallet email
    last_error      text,
    created_at      timestamp with time zone NOT NULL DEFAULT now(),
    updated_at      timestamp with time zone NOT NULL DEFAULT now()
);

-- A bought domain's hosts (apex, www., admin.) are custom-domain rows the order manages, not the owner.
ALTER TABLE public.tenant_custom_domains ADD COLUMN IF NOT EXISTS order_id uuid;
