-- storefront-service: tables. Load order comes from scripts/db-files.mjs.

--
-- Name: pending_payment_intents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_payment_intents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    razorpay_order_id text NOT NULL,
    draft_token text NOT NULL,
    user_id uuid NOT NULL,
    amount_paise integer NOT NULL,
    committed boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pending_payment_intents_pkey PRIMARY KEY (id),
    CONSTRAINT pending_payment_intents_razorpay_order_id_key UNIQUE (razorpay_order_id)
);


--
-- Name: subscription_plans_cache; Type: TABLE; Schema: public; Owner: -
--
-- Razorpay Plan ids we have already created, cached so repeated subscribes reuse one plan.
-- Keyed on (period, interval_count, amount_paise, collecting_account): repricing a product
-- versions to a NEW plan row rather than mutating an existing subscriber's plan.

CREATE TABLE public.subscription_plans_cache (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid NOT NULL,
    period character varying(10) NOT NULL,
    interval_count integer DEFAULT 1 NOT NULL,
    amount_paise bigint NOT NULL,
    collecting_account character varying(12) DEFAULT 'platform'::character varying NOT NULL,
    razorpay_plan_id character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
