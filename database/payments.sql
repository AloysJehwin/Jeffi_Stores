-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: expense_payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expense_payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    expense_id uuid,
    amount numeric(12,2) NOT NULL,
    payment_date date NOT NULL,
    payment_method character varying(50),
    reference character varying(255),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    payout_id text,
    payout_status text
);


--
-- Name: expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.expenses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    expense_number character varying(50) NOT NULL,
    supplier_name character varying(255) NOT NULL,
    supplier_gstin character varying(20),
    description text,
    amount numeric(12,2) NOT NULL,
    tax_amount numeric(12,2) DEFAULT 0,
    total_amount numeric(12,2) NOT NULL,
    expense_date date NOT NULL,
    due_date date,
    status character varying(20) DEFAULT 'unpaid'::character varying,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    po_id uuid,
    grn_id uuid
);


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    payment_method character varying(50) NOT NULL,
    payment_gateway character varying(50),
    transaction_id character varying(255),
    amount numeric(12,2) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying,
    gateway_response jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


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

-- Jeffi's own tax invoices to tenants (plan subscription charges, wallet top-ups). One per Razorpay
-- payment (kind + external_ref), so the browser verify, admin verify and webhook paths issue it once.
CREATE TABLE IF NOT EXISTS public.platform_invoices (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid NOT NULL,
    kind character varying(24) NOT NULL,
    external_ref character varying(64) NOT NULL,
    number character varying(40),
    document_id uuid,
    view_url text,
    taxable_inr numeric(12,2) NOT NULL DEFAULT 0,
    gst_inr numeric(12,2) NOT NULL DEFAULT 0,
    total_inr numeric(12,2) NOT NULL DEFAULT 0,
    emailed_to character varying(255),
    sent_at timestamp with time zone,
    error text,
    created_at timestamp with time zone NOT NULL DEFAULT now()
);
