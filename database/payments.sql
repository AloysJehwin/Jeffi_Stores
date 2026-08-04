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
