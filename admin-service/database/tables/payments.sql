-- admin-service: tables. Load order comes from scripts/db-files.mjs.

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
    updated_at timestamp with time zone DEFAULT now(),
    gateway_account text,
    gateway_method text,
    card_network text,
    card_type text,
    card_last4 text,
    card_issuer text,
    bank text,
    wallet text,
    vpa text,
    fee numeric(12,2),
    tax numeric(12,2),
    captured_at timestamp with time zone,
    error_code text,
    error_reason text,
    error_source text,
    error_step text,
    error_description text
);


--
-- Name: payment_refunds; Type: TABLE; Schema: public; Owner: -
--
-- One row per Razorpay refund, made in the app or on the dashboard. Status only moves forward.

CREATE TABLE public.payment_refunds (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    razorpay_refund_id text NOT NULL,
    razorpay_payment_id text NOT NULL,
    payment_id uuid,
    order_id uuid,
    amount numeric(12,2) NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    speed_requested text,
    speed_processed text,
    arn text,
    acquirer_data jsonb,
    purpose text,
    initiated_by text DEFAULT 'app'::text NOT NULL,
    failure_reason text,
    retry_of uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    failed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_disputes; Type: TABLE; Schema: public; Owner: -
--
-- A chargeback raised by the customer's bank, from Razorpay's dispute events.

CREATE TABLE public.payment_disputes (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    razorpay_dispute_id text NOT NULL,
    razorpay_payment_id text NOT NULL,
    payment_id uuid,
    order_id uuid,
    amount numeric(12,2) NOT NULL,
    amount_deducted numeric(12,2) DEFAULT 0 NOT NULL,
    reason_code text,
    reason_description text,
    phase text,
    status text DEFAULT 'open'::text NOT NULL,
    respond_by timestamp with time zone,
    last_event text,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    closed_at timestamp with time zone
);


--
-- Name: razorpay_settlements; Type: TABLE; Schema: public; Owner: -
--
-- A settlement Razorpay paid into the store's bank (setl_ id), on the platform account (the
-- flagship) or the store's own account. amount is the net that reached the bank.

CREATE TABLE public.razorpay_settlements (
    id text NOT NULL,
    account text NOT NULL,
    key_id text,
    amount numeric(14,2) NOT NULL,
    fees numeric(12,2) DEFAULT 0 NOT NULL,
    tax numeric(12,2) DEFAULT 0 NOT NULL,
    utr text,
    status text,
    settled_at timestamp with time zone,
    item_count integer DEFAULT 0 NOT NULL,
    lines_credit numeric(14,2) DEFAULT 0 NOT NULL,
    lines_debit numeric(14,2) DEFAULT 0 NOT NULL,
    raw jsonb,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: razorpay_settlement_items; Type: TABLE; Schema: public; Owner: -
--
-- One line of a settlement report (a payment, refund, transfer or adjustment), with what it was
-- matched to: an order here, another store's sale (flagship only), platform billing, or nothing.

CREATE TABLE public.razorpay_settlement_items (
    settlement_id text NOT NULL,
    entity_id text NOT NULL,
    type text NOT NULL,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    credit numeric(14,2) DEFAULT 0 NOT NULL,
    debit numeric(14,2) DEFAULT 0 NOT NULL,
    fee numeric(12,2) DEFAULT 0 NOT NULL,
    tax numeric(12,2) DEFAULT 0 NOT NULL,
    on_hold boolean DEFAULT false NOT NULL,
    method text,
    card_network text,
    card_type text,
    payment_id text,
    rzp_order_id text,
    order_receipt text,
    dispute_id text,
    description text,
    notes jsonb,
    entity_created_at timestamp with time zone,
    settled_at timestamp with time zone,
    scope text DEFAULT 'unmatched'::text NOT NULL,
    order_id uuid,
    local_payment_id uuid,
    order_number text,
    source_tenant_id uuid,
    source_tenant_slug text,
    source_order_ref text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: upi_payment_intents; Type: TABLE; Schema: public; Owner: -
--
-- One UPI payment attempt (PhonePe PG, or UPG: pay the merchant's UPI ID, seen in its bank alerts) and
-- what it pays for. merchant_order_id = 'JS' + id without dashes (docs/PAYMENTS_UPI.md).
-- UPG: one intent per receiving_vpa is active/processing at a time; the rest queue FIFO.

CREATE TABLE public.upi_payment_intents (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    tenant_id uuid,
    provider character varying(16) NOT NULL,
    purpose character varying(32) NOT NULL,
    amount_paise bigint NOT NULL,
    currency character(3) DEFAULT 'INR'::bpchar NOT NULL,
    merchant_order_id character varying(63) NOT NULL,
    provider_order_id text,
    provider_txn_id text,
    utr text,
    payer_vpa text,
    status character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    redirect_url text,
    return_to text,
    refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb,
    error_code text,
    expires_at timestamp with time zone,
    confirmed_at timestamp with time zone,
    decided_by uuid,
    decided_at timestamp with time zone,
    receiving_vpa text,
    active_at timestamp with time zone,
    pay_expires_at timestamp with time zone,
    processing_at timestamp with time zone,
    verify_expires_at timestamp with time zone,
    observation_id uuid,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: upi_bank_observations; Type: TABLE; Schema: public; Owner: -
--
-- A credit seen in the merchant's bank-alert email (lib/payments/upi/alerts.ts). Only trusted rows
-- (bank domain + DKIM, or Gmail's ARC seal attesting it) complete an intent; the rest are shown to staff.
-- kind 'gmail_forwarding' keeps Gmail's forwarding-confirmation code and link for the owner.

CREATE TABLE public.upi_bank_observations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    kind character varying(24) DEFAULT 'credit'::character varying NOT NULL,
    receiving_vpa text,
    amount_paise bigint,
    utr text,
    sender_vpa text,
    bank_domain text,
    ses_message_id text,
    message_id text,
    fingerprint text NOT NULL,
    trusted boolean DEFAULT false NOT NULL,
    subject text,
    details jsonb,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    matched_intent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
