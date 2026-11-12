-- storefront-service: tables. Load order comes from scripts/db-files.mjs.

-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: back_in_stock_notify; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.back_in_stock_notify (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    email text NOT NULL,
    notified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    notified_at timestamp with time zone
);


--
-- Name: cart_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cart_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    product_id uuid,
    variant_id uuid,
    quantity numeric(10,3) DEFAULT 1 NOT NULL,
    price_at_addition numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    buy_mode character varying(10) DEFAULT 'unit'::character varying NOT NULL,
    buy_unit character varying(10),
    sub_variant_id uuid,
    saved_for_later boolean DEFAULT false NOT NULL,
    saved_at timestamp with time zone,
    snapshot_price numeric(12,2),
    snapshot_in_stock boolean,
    snapshot_taken_at timestamp with time zone
);


--
-- Name: order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    product_id uuid,
    variant_id uuid,
    product_name character varying(255) NOT NULL,
    product_sku character varying(100),
    variant_name character varying(255),
    quantity numeric(10,3) NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    total_price numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    hsn_code character varying(20),
    gst_rate numeric(5,2),
    taxable_amount numeric(12,2) DEFAULT 0,
    cgst_amount numeric(12,2) DEFAULT 0,
    sgst_amount numeric(12,2) DEFAULT 0,
    igst_amount numeric(12,2) DEFAULT 0,
    buy_mode character varying(10) DEFAULT 'unit'::character varying NOT NULL,
    buy_unit character varying(10),
    sub_variant_id uuid,
    sub_variant_name character varying(255),
    sold_unit character varying(20),
    sold_unit_factor numeric(14,6),
    base_quantity numeric(14,4),
    applied_rules jsonb,
    mrp numeric(12,2) DEFAULT NULL::numeric,
    batch_id uuid,
    discount_pct numeric DEFAULT 0 NOT NULL,
    weight_grams    integer,
    package_type    varchar(30),
    length_cm       numeric(6,2),
    breadth_cm      numeric(6,2),
    height_cm       numeric(6,2),
    is_digital      boolean DEFAULT false NOT NULL,
    is_returnable   boolean DEFAULT true NOT NULL,
    granted_at      timestamp with time zone,
    access_revoked_at timestamp with time zone
);


--
-- Name: order_status_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.order_status_history (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    status character varying(50) NOT NULL,
    comment text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: vault_entitlements; Type: TABLE; Schema: public; Owner: -
--
-- One row per granted digital order_item. The vault checks (user_id, status='active', not expired)
-- before serving a file. access_expires_at is NULL for one-time purchases and set for subscription
-- access (paid-period end + grace).

CREATE TABLE public.vault_entitlements (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    order_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    source character varying(12) DEFAULT 'one_time'::character varying NOT NULL,
    status character varying(10) DEFAULT 'active'::character varying NOT NULL,
    subscription_id uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    access_expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoke_reason character varying(40),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscription_cycle_orders; Type: TABLE; Schema: public; Owner: -
--
-- Idempotency ledger linking a Razorpay subscription charge to the order we minted for that cycle.
-- UNIQUE (subscription_id, cycle_number) and UNIQUE razorpay_payment_id both guard double-commit
-- when the verify endpoint and the webhook race.

CREATE TABLE public.subscription_cycle_orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    subscription_id uuid NOT NULL,
    cycle_number integer NOT NULL,
    order_id uuid,
    razorpay_payment_id character varying(64) NOT NULL,
    razorpay_invoice_id character varying(64),
    amount_paise bigint NOT NULL,
    status character varying(16) DEFAULT 'committed'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscription_redemptions; Type: TABLE; Schema: public; Owner: -
--
-- One PhonePe Autopay renewal attempt: notified >= 24 h before the due date, executed on it. The paid
-- cycle's order is still minted through subscription_cycle_orders (keyed by the PhonePe transaction id).

CREATE TABLE public.subscription_redemptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    subscription_id uuid NOT NULL,
    cycle_number integer NOT NULL,
    merchant_order_id character varying(63) NOT NULL,
    provider_order_id text,
    provider_txn_id text,
    utr text,
    amount_paise bigint NOT NULL,
    due_at timestamp with time zone NOT NULL,
    status character varying(16) DEFAULT 'notifying'::character varying NOT NULL,
    notified_at timestamp with time zone,
    execute_after timestamp with time zone,
    executed_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: return_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.return_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    user_id uuid,
    type character varying(20) NOT NULL,
    status character varying(50) DEFAULT 'pending_approval'::character varying NOT NULL,
    reason character varying(100) NOT NULL,
    description text,
    admin_notes text,
    return_tracking_number character varying(255),
    received_at timestamp with time zone,
    resolved_at timestamp with time zone,
    replacement_order_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    rvp_awb_number character varying(64),
    rvp_created_at timestamp with time zone,
    rvp_delivery_charge numeric(12,2),
    image_urls text[] DEFAULT '{}'::text[],
    valuation_status character varying(20) DEFAULT NULL::character varying,
    valuation_condition character varying(20) DEFAULT NULL::character varying,
    valuation_notes text,
    valuated_at timestamp with time zone,
    reviewed_by uuid,
    reviewed_at timestamp with time zone
);


--
-- Name: return_request_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.return_request_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    return_request_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    product_id uuid,
    variant_id uuid,
    quantity numeric(10,3) NOT NULL,
    unit_price numeric(12,2) NOT NULL,
    refund_amount numeric(12,2) NOT NULL,
    product_name character varying(255),
    variant_name character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT return_request_items_pkey PRIMARY KEY (id)
);

--
-- Name: order_adjustment_lines; Type: TABLE; Schema: public; Owner: -
-- One changed order line. order_item_id has no FK: a removed line's row is deleted, the snapshot stays here.
--

CREATE TABLE public.order_adjustment_lines (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    adjustment_id uuid NOT NULL,
    order_item_id uuid NOT NULL,
    action character varying(20) NOT NULL,
    old_snapshot jsonb NOT NULL,
    new_product_id uuid,
    new_variant_id uuid,
    new_sub_variant_id uuid,
    new_unit character varying(20),
    new_unit_factor numeric(14,6),
    new_quantity numeric(10,3),
    new_unit_price numeric(12,2),
    new_line jsonb,
    old_total numeric(12,2) NOT NULL,
    new_total numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

--
-- Name: address_change_requests; Type: TABLE; Schema: public; Owner: -
-- Customer-initiated delivery address change on a CONFIRMED order (pre-shipment).
-- An admin approves or rejects; the order's address only changes on approval.
--

CREATE TABLE public.address_change_requests (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid NOT NULL,
    requested_by_user_id uuid,
    old_address_id uuid,
    new_address_id uuid,
    old_address_snapshot jsonb,
    new_address_snapshot jsonb NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    admin_notes text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);
