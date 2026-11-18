--
-- ai_wallet_holds: a paid AI generation's hold on its tenant's wallet (packages/store-core/src/lib/ai/paid-generation.ts).
-- The cap's wallet_ledger debit (external_ref aigen:<ref>) and this row are written in one transaction; the run
-- checkpoints its provider cost here as it spends. Settling claims the row (settled_at IS NULL) and trues the debit up
-- to min(cap, cost × margin) in one transaction, so it happens once: by the run, or, when the run never did (its process
-- died), by the controller's ai_hold_sweep cron two hours on, on the cost recorded so far. A flat-priced run (a Showcase
-- redesign) settles at the whole cap or nothing and records no cost until then, so the sweep refunds it.
--
CREATE TABLE IF NOT EXISTS public.ai_wallet_holds (
    id            uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id     uuid NOT NULL,
    external_ref  character varying(64) NOT NULL,                     -- the hold's wallet_ledger debit: aigen:<ref>
    cap_inr       numeric(12,2) NOT NULL,                             -- debited up front; never charged more
    margin        numeric(6,3) NOT NULL,                              -- charge = provider cost × this (AI_REGEN_MARGIN when held)
    cost_inr      numeric(12,4) NOT NULL DEFAULT 0,                   -- provider cost so far
    feature       character varying(64) NOT NULL DEFAULT 'site_generation', -- ai_usage feature of the charge row
    usage_db      character varying(16) NOT NULL DEFAULT 'platform',  -- store|platform: the database the run logs ai_usage in
    started_at    timestamp with time zone NOT NULL DEFAULT now(),
    cost_at       timestamp with time zone,                           -- last cost checkpoint
    settled_at    timestamp with time zone,
    settled_by    character varying(16),                              -- run|sweep
    charged_inr   numeric(12,2),                                      -- what the debit was trued-up to
    last_error    text                                                -- the sweep's last failure to settle it
);
