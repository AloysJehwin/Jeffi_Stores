-- Module: 00_extensions
--
-- PostgreSQL database dump
--

\restrict sApkcCOWPvYzNoz8yqPDF7aYvaKpmJ9edr7JeDtXwMb8moDXhiz5HfOtkSAhIc6

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.12

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


-- Module: 01_users
--
-- Name: addresses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addresses (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    address_type character varying(50) DEFAULT 'shipping'::character varying,
    is_default boolean DEFAULT false,
    full_name character varying(255) NOT NULL,
    phone character varying(20) NOT NULL,
    address_line1 character varying(255) NOT NULL,
    address_line2 character varying(255),
    landmark character varying(255),
    city character varying(100) NOT NULL,
    state character varying(100) NOT NULL,
    postal_code character varying(20) NOT NULL,
    country character varying(100) DEFAULT 'India'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    state_code character varying(3)
);


--
-- Name: admin_certificates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_certificates (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    admin_id uuid NOT NULL,
    serial_number character varying(100) NOT NULL,
    common_name character varying(255) NOT NULL,
    issued_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    is_revoked boolean DEFAULT false,
    revoked_at timestamp with time zone,
    download_token character varying(255),
    downloaded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    p12_data bytea,
    p12_password character varying(64)
);


--
-- Name: admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admins (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    username character varying(100) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role character varying(50) DEFAULT 'admin'::character varying,
    created_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone,
    scopes jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true
);


--
-- Name: customer_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.customer_profiles (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    company_name character varying(255),
    gst_number character varying(50),
    customer_type character varying(50) DEFAULT 'retail'::character varying,
    credit_limit numeric(12,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: otp_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.otp_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email character varying(255) NOT NULL,
    otp character varying(6) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    verified boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(20),
    first_name character varying(100),
    last_name character varying(100),
    password_hash character varying(255),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_login timestamp with time zone,
    is_active boolean DEFAULT true,
    is_guest boolean DEFAULT false,
    session_id text,
    merged_to_user_id uuid,
    is_flagged boolean DEFAULT false,
    flag_reason text,
    google_id text,
    auth_provider character varying(20) DEFAULT 'email'::character varying
);


-- Module: 02_catalog
--
-- Name: brands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.brands (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    logo_url character varying(500),
    description text,
    website character varying(255),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: categories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.categories (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    slug character varying(100) NOT NULL,
    description text,
    image_url character varying(500),
    parent_category_id uuid,
    display_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    sku_prefix character varying(10),
    google_product_category character varying(255),
    icon_name character varying(100)
);


--
-- Name: gallery_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.gallery_images (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    image_url character varying(500) NOT NULL,
    thumbnail_url character varying(500),
    s3_key character varying(500) NOT NULL,
    s3_thumbnail_key character varying(500),
    s3_bucket character varying(100),
    file_name character varying(255),
    file_size integer,
    mime_type character varying(100) DEFAULT 'image/jpeg'::character varying,
    width integer,
    height integer,
    source_url character varying(1000),
    created_at timestamp with time zone DEFAULT now(),
    custom_name character varying(255),
    category_id uuid
);


--
-- Name: product_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_images (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid,
    image_url character varying(500) NOT NULL,
    thumbnail_url character varying(500),
    s3_bucket character varying(100),
    s3_key character varying(500),
    s3_thumbnail_key character varying(500),
    file_name character varying(255) NOT NULL,
    file_size integer,
    mime_type character varying(100),
    width integer,
    height integer,
    alt_text character varying(255),
    display_order integer DEFAULT 0,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_sub_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_sub_variants (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    variant_id uuid NOT NULL,
    product_id uuid NOT NULL,
    sku character varying(100) NOT NULL,
    sub_variant_name character varying(255) NOT NULL,
    price numeric(12,2),
    mrp numeric(12,2),
    price_ex_gst numeric(12,2),
    mrp_ex_gst numeric(12,2),
    wholeprice_ex_gst numeric(12,2),
    stock_quantity integer DEFAULT 0,
    attributes jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid,
    sku character varying(100) NOT NULL,
    variant_name character varying(255) NOT NULL,
    price numeric(12,2),
    stock_quantity integer DEFAULT 0,
    attributes jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    mrp numeric(12,2),
    price_ex_gst numeric(12,2),
    wholeprice_ex_gst numeric(12,2),
    mpn character varying(100),
    gtin character varying(50),
    pricing_type character varying(20) DEFAULT 'unit'::character varying NOT NULL,
    unit character varying(20),
    numeric_value numeric(10,3),
    updated_at timestamp with time zone DEFAULT now(),
    weight_grams integer DEFAULT 500,
    length_cm numeric(6,2) DEFAULT 10,
    breadth_cm numeric(6,2) DEFAULT 10,
    height_cm numeric(6,2) DEFAULT 10,
    package_type character varying(30),
    cost_price numeric(12,2) DEFAULT 0,
    inventory_quantity integer DEFAULT 0 NOT NULL,
    mrp_ex_gst numeric(12,2),
    variant_type character varying(100),
    sub_variant_type text,
    sub_variant_type_on boolean DEFAULT false NOT NULL,
    use_own_images boolean DEFAULT false NOT NULL
);


--
-- Name: products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.products (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    category_id uuid,
    brand_id uuid,
    sku character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    slug character varying(255) NOT NULL,
    description text,
    short_description character varying(500),
    base_price numeric(12,2) NOT NULL,
    price_ex_gst numeric(12,2),
    wholeprice_ex_gst numeric(12,2),
    currency character varying(10) DEFAULT 'INR'::character varying,
    stock_quantity integer DEFAULT 0,
    low_stock_threshold integer DEFAULT 10,
    is_in_stock boolean DEFAULT true,
    weight numeric(10,2),
    dimensions character varying(100),
    material character varying(100),
    finish character varying(100),
    size character varying(100),
    is_featured boolean DEFAULT false,
    is_active boolean DEFAULT true,
    views_count integer DEFAULT 0,
    sales_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    search_vector tsvector,
    mrp numeric(12,2),
    gst_percentage numeric(5,2) DEFAULT 18,
    hsn_code character varying(20),
    has_variants boolean DEFAULT false,
    variant_type character varying(50),
    mpn character varying(100),
    gtin character varying(50),
    weight_grams integer DEFAULT 500,
    length_cm numeric(6,2) DEFAULT 10,
    breadth_cm numeric(6,2) DEFAULT 10,
    height_cm numeric(6,2) DEFAULT 10,
    package_type character varying(30),
    cost_price numeric(12,2) DEFAULT 0,
    inventory_quantity integer DEFAULT 0 NOT NULL,
    mrp_ex_gst numeric(12,2),
    sub_variant_type character varying(100)
);


--
-- Name: variant_images; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.variant_images (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    variant_id uuid NOT NULL,
    image_url character varying(500) NOT NULL,
    thumbnail_url character varying(500),
    s3_bucket character varying(100),
    s3_key character varying(500),
    s3_thumbnail_key character varying(500),
    file_name character varying(255) NOT NULL,
    file_size integer,
    mime_type character varying(100),
    width integer,
    height integer,
    alt_text character varying(255),
    display_order integer DEFAULT 0,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


-- Module: 03_inventory
--
-- Name: grn_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grn_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    grn_id uuid,
    po_item_id uuid,
    product_id uuid,
    variant_id uuid,
    quantity_received numeric(10,3) NOT NULL,
    unit_cost numeric(12,2) NOT NULL
);


--
-- Name: grns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grns (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    grn_number character varying(50) NOT NULL,
    po_id uuid,
    supplier_id uuid,
    received_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: inventory_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_transactions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid,
    variant_id uuid,
    transaction_type character varying(50) NOT NULL,
    quantity_change integer NOT NULL,
    quantity_after integer NOT NULL,
    reference_type character varying(50),
    reference_id uuid,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: price_inflation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.price_inflation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category_id uuid NOT NULL,
    category_name character varying(100) NOT NULL,
    percentage numeric(5,2) NOT NULL,
    applied_fields text[] NOT NULL,
    product_count integer DEFAULT 0 NOT NULL,
    applied_by character varying(100),
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    snapshot jsonb,
    is_rollback boolean DEFAULT false NOT NULL,
    rolled_back_at timestamp with time zone,
    rolled_back_by character varying(100)
);


--
-- Name: suppliers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppliers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    gstin character varying(20),
    contact_name character varying(255),
    phone character varying(20),
    email character varying(255),
    address text,
    payment_terms integer DEFAULT 30,
    notes text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    bank_name text,
    account_number text,
    ifsc text,
    upi_id text
);


-- Module: 04_orders
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
    buy_unit character varying(10)
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
    buy_unit character varying(10)
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
-- Name: orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_number character varying(50) NOT NULL,
    user_id uuid,
    customer_email character varying(255),
    customer_phone character varying(20),
    customer_name character varying(255),
    status character varying(50) DEFAULT 'pending'::character varying,
    payment_status character varying(50) DEFAULT 'unpaid'::character varying,
    subtotal numeric(12,2) NOT NULL,
    discount_amount numeric(12,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    shipping_amount numeric(12,2) DEFAULT 0,
    total_amount numeric(12,2) NOT NULL,
    shipping_address_id uuid,
    billing_address_id uuid,
    shipping_method character varying(100),
    tracking_number character varying(255),
    notes text,
    admin_notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    confirmed_at timestamp with time zone,
    shipped_at timestamp with time zone,
    delivered_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    invoice_number character varying(50),
    invoice_date timestamp with time zone,
    taxable_amount numeric(12,2) DEFAULT 0,
    cgst_amount numeric(12,2) DEFAULT 0,
    sgst_amount numeric(12,2) DEFAULT 0,
    igst_amount numeric(12,2) DEFAULT 0,
    is_igst boolean DEFAULT false,
    buyer_gstin character varying(20),
    cancellation_note text,
    tracking_url text,
    original_order_id uuid,
    awb_number character varying(64),
    delhivery_shipment_id character varying(128),
    irn character varying(64),
    irn_ack_no character varying(32),
    irn_ack_dt timestamp with time zone,
    signed_qr text,
    irn_status character varying(20) DEFAULT 'pending'::character varying,
    irn_cancelled_at timestamp with time zone,
    eway_bill_no character varying(20),
    eway_bill_date timestamp with time zone,
    eway_bill_valid_upto timestamp with time zone,
    payment_link_id character varying(64),
    payment_link_url text,
    payment_link_status character varying(20),
    payment_link_expires_at timestamp with time zone,
    source character varying(20) DEFAULT 'online'::character varying NOT NULL,
    search_vector tsvector,
    order_type character varying(10) DEFAULT 'cart'::character varying NOT NULL,
    view_token uuid DEFAULT gen_random_uuid()
);


--
-- Name: wishlist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wishlist_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    product_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


-- Module: 05_payments
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


-- Module: 06_shipping
--
-- Name: delhivery_pickup_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delhivery_pickup_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pickup_id character varying(128),
    pickup_date date NOT NULL,
    awb_count integer NOT NULL,
    awbs text[] NOT NULL,
    raw_response jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pickup_status character varying(32) DEFAULT 'pending'::character varying NOT NULL
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
    rvp_created_at timestamp with time zone
);


--
-- Name: shipping_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shipping_zones (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    name character varying(100) NOT NULL,
    states jsonb,
    base_rate numeric(10,2) NOT NULL,
    per_kg_rate numeric(10,2) DEFAULT 0,
    free_shipping_threshold numeric(12,2),
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


-- Module: 07_quotations
--
-- Name: purchase_order_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_order_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    po_id uuid,
    product_id uuid,
    variant_id uuid,
    product_name character varying(255) NOT NULL,
    sku character varying(100),
    quantity numeric(10,3) NOT NULL,
    unit_cost numeric(12,2) NOT NULL,
    tax_rate numeric(5,2) DEFAULT 0,
    total_cost numeric(12,2) NOT NULL,
    quantity_received numeric(10,3) DEFAULT 0
);


--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.purchase_orders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    po_number character varying(50) NOT NULL,
    supplier_id uuid,
    status character varying(20) DEFAULT 'draft'::character varying,
    order_date date DEFAULT CURRENT_DATE NOT NULL,
    expected_date date,
    notes text,
    subtotal numeric(12,2) DEFAULT 0,
    tax_amount numeric(12,2) DEFAULT 0,
    total_amount numeric(12,2) DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    view_token uuid DEFAULT gen_random_uuid()
);


--
-- Name: quotation_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotation_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    quotation_id uuid NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    description text NOT NULL,
    hsn_code character varying(20),
    gst_rate numeric(5,2) DEFAULT 18 NOT NULL,
    quantity numeric(12,3) NOT NULL,
    unit character varying(20) DEFAULT 'PCS'::character varying NOT NULL,
    rate numeric(12,4) NOT NULL,
    discount_pct numeric(5,2) DEFAULT 0,
    amount numeric(12,4) NOT NULL,
    product_id uuid,
    variant_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: quotations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.quotations (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    quote_number character varying(60) NOT NULL,
    quote_date date DEFAULT CURRENT_DATE NOT NULL,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    consignee_name text,
    consignee_addr1 text,
    consignee_addr2 text,
    consignee_city text,
    consignee_state text DEFAULT 'Chhattisgarh'::text,
    consignee_gstin text,
    buyer_same boolean DEFAULT true NOT NULL,
    buyer_name text,
    buyer_addr1 text,
    buyer_addr2 text,
    buyer_city text,
    buyer_state text DEFAULT 'Chhattisgarh'::text,
    buyer_gstin text,
    notes text,
    subtotal numeric(12,4) DEFAULT 0,
    cgst_amount numeric(12,4) DEFAULT 0,
    sgst_amount numeric(12,4) DEFAULT 0,
    total_amount numeric(12,4) DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    converted_order_id uuid,
    consignee_phone character varying(20),
    consignee_pincode character varying(10),
    search_vector tsvector,
    buyer_phone character varying(20),
    buyer_pincode character varying(10),
    buyer_email text,
    consignee_email text,
    view_token uuid DEFAULT gen_random_uuid()
);


-- Module: 08_marketing
--
-- Name: coupon_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_usage (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    coupon_id uuid,
    user_id uuid,
    order_id uuid,
    discount_amount numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    code character varying(50) NOT NULL,
    description text,
    discount_type character varying(20) NOT NULL,
    discount_value numeric(12,2) NOT NULL,
    min_purchase_amount numeric(12,2) DEFAULT 0,
    max_discount_amount numeric(12,2),
    usage_limit integer,
    usage_limit_per_user integer DEFAULT 1,
    times_used integer DEFAULT 0,
    valid_from timestamp with time zone,
    valid_until timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_campaign_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaign_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    status character varying(20) DEFAULT 'sent'::character varying NOT NULL,
    error text,
    sent_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    template_key character varying(50) NOT NULL,
    subject character varying(255) NOT NULL,
    template_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    audience_type character varying(50) DEFAULT 'all'::character varying NOT NULL,
    audience_filter jsonb DEFAULT '{}'::jsonb NOT NULL,
    recipient_count integer,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


-- Module: 09_reviews
--
-- Name: product_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_reviews (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid,
    user_id uuid,
    rating integer,
    title character varying(255),
    comment text,
    is_verified_purchase boolean DEFAULT false,
    is_approved boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    image_thumbnail_urls text[] DEFAULT '{}'::text[] NOT NULL,
    image_urls text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT product_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: review_form_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_form_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    form_id uuid,
    phone character varying(15),
    screenshot_url text NOT NULL,
    coupon_code character varying(50),
    status character varying(20) DEFAULT 'pending'::character varying,
    submitted_at timestamp with time zone DEFAULT now(),
    email character varying(255),
    extra_fields jsonb DEFAULT '{}'::jsonb
);


--
-- Name: review_forms; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_forms (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(100) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    google_review_url text NOT NULL,
    coupon_id uuid,
    is_active boolean DEFAULT true,
    submissions_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    custom_fields jsonb DEFAULT '[]'::jsonb,
    template_type text DEFAULT 'google_review'::text NOT NULL
);


-- Module: 10_invoices
--
-- Name: cash_sale_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_sale_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sale_id uuid NOT NULL,
    product_id uuid,
    variant_id uuid,
    product_name character varying NOT NULL,
    product_sku character varying,
    variant_name character varying,
    hsn_code character varying,
    gst_rate numeric DEFAULT 18 NOT NULL,
    quantity numeric NOT NULL,
    unit_price numeric NOT NULL,
    discount_amount numeric DEFAULT 0 NOT NULL,
    tax_amount numeric DEFAULT 0 NOT NULL,
    total_price numeric NOT NULL,
    taxable_amount numeric DEFAULT 0 NOT NULL,
    cgst_amount numeric DEFAULT 0 NOT NULL,
    sgst_amount numeric DEFAULT 0 NOT NULL,
    igst_amount numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cash_sales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cash_sales (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    sale_number character varying NOT NULL,
    invoice_number character varying,
    invoice_date timestamp with time zone DEFAULT now(),
    financial_year character varying,
    sequence_number integer,
    customer_name character varying DEFAULT 'Walk-in Customer'::character varying NOT NULL,
    customer_phone character varying,
    payment_mode character varying DEFAULT 'cash'::character varying NOT NULL,
    payment_status character varying DEFAULT 'paid'::character varying NOT NULL,
    subtotal numeric NOT NULL,
    tax_amount numeric DEFAULT 0 NOT NULL,
    total_amount numeric NOT NULL,
    taxable_amount numeric DEFAULT 0 NOT NULL,
    cgst_amount numeric DEFAULT 0 NOT NULL,
    sgst_amount numeric DEFAULT 0 NOT NULL,
    igst_amount numeric DEFAULT 0 NOT NULL,
    is_igst boolean DEFAULT false NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    search_vector tsvector
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    order_id uuid,
    invoice_number character varying(50) NOT NULL,
    financial_year character varying(10) NOT NULL,
    sequence_number integer NOT NULL,
    pdf_url character varying(500),
    generated_at timestamp with time zone DEFAULT now()
);


-- Module: 11_logs
--
-- Name: email_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    email character varying(255) NOT NULL,
    subject character varying(255),
    template_name character varying(100),
    status character varying(50) DEFAULT 'sent'::character varying,
    sent_at timestamp with time zone DEFAULT now(),
    metadata jsonb
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    type character varying(50) NOT NULL,
    title character varying(255) NOT NULL,
    message text,
    link character varying(500),
    is_read boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: page_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.page_events (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id character varying(64) NOT NULL,
    user_id uuid,
    page character varying(32) NOT NULL,
    path text NOT NULL,
    referrer text,
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: product_views; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_views (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid,
    user_id uuid,
    session_id character varying(255),
    ip_address inet,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: search_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_queries (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    query character varying(255) NOT NULL,
    results_count integer,
    clicked_product_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


-- Module: 12_support
--
-- Name: support_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_messages (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    session_id uuid,
    sender character varying(10) NOT NULL,
    message text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: support_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.support_sessions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid,
    status character varying(20) DEFAULT 'open'::character varying,
    admin_name character varying(100),
    created_at timestamp with time zone DEFAULT now(),
    closed_at timestamp with time zone
);


--
-- Name: websocket_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.websocket_connections (
    connection_id character varying(200) NOT NULL,
    user_id uuid,
    session_id uuid,
    role character varying(10) NOT NULL,
    connected_at timestamp with time zone DEFAULT now()
);


-- Module: 13_settings
--
-- Name: site_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.site_settings (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    key character varying(100) NOT NULL,
    value text,
    data_type character varying(50) DEFAULT 'string'::character varying,
    description text,
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid
);


-- Module: 14_indexes
--
-- Name: idx_addresses_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_addresses_user_id ON public.addresses USING btree (user_id);


--
-- Name: idx_admin_certs_admin_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_certs_admin_id ON public.admin_certificates USING btree (admin_id);


--
-- Name: idx_admin_certs_download_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_certs_download_token ON public.admin_certificates USING btree (download_token);


--
-- Name: idx_admin_certs_serial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_admin_certs_serial ON public.admin_certificates USING btree (serial_number);


--
-- Name: idx_cart_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cart_user_id ON public.cart_items USING btree (user_id);


--
-- Name: idx_cash_sale_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sale_items_product_id ON public.cash_sale_items USING btree (product_id);


--
-- Name: idx_cash_sale_items_sale_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sale_items_sale_id ON public.cash_sale_items USING btree (sale_id);


--
-- Name: idx_cash_sales_invoice_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sales_invoice_date ON public.cash_sales USING btree (invoice_date);


--
-- Name: idx_cash_sales_invoice_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sales_invoice_number ON public.cash_sales USING btree (invoice_number);


--
-- Name: idx_cash_sales_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cash_sales_search_vector ON public.cash_sales USING gin (search_vector);


--
-- Name: idx_categories_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_parent ON public.categories USING btree (parent_category_id);


--
-- Name: idx_categories_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_categories_slug ON public.categories USING btree (slug);


--
-- Name: idx_customer_profiles_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_customer_profiles_user_id ON public.customer_profiles USING btree (user_id);


--
-- Name: idx_delhivery_pickup_requests_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_delhivery_pickup_requests_created_at ON public.delhivery_pickup_requests USING btree (created_at DESC);


--
-- Name: idx_email_campaign_logs_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_campaign_logs_campaign ON public.email_campaign_logs USING btree (campaign_id);


--
-- Name: idx_email_campaigns_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_campaigns_status ON public.email_campaigns USING btree (status);


--
-- Name: idx_expense_payments_expense_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_payments_expense_id ON public.expense_payments USING btree (expense_id);


--
-- Name: idx_expense_payments_payout_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expense_payments_payout_id ON public.expense_payments USING btree (payout_id);


--
-- Name: idx_expenses_due_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_due_date ON public.expenses USING btree (due_date);


--
-- Name: idx_expenses_grn_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_grn_id ON public.expenses USING btree (grn_id);


--
-- Name: idx_expenses_po_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_po_id ON public.expenses USING btree (po_id);


--
-- Name: idx_expenses_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_expenses_status ON public.expenses USING btree (status);


--
-- Name: idx_gallery_images_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_gallery_images_created ON public.gallery_images USING btree (created_at DESC);


--
-- Name: idx_grn_po; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grn_po ON public.grns USING btree (po_id);


--
-- Name: idx_inv_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_created_at ON public.inventory_transactions USING btree (created_at DESC);


--
-- Name: idx_inv_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_product_id ON public.inventory_transactions USING btree (product_id);


--
-- Name: idx_inv_reference; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_reference ON public.inventory_transactions USING btree (reference_type, reference_id);


--
-- Name: idx_inv_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inv_variant_id ON public.inventory_transactions USING btree (variant_id);


--
-- Name: idx_notifications_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_created_at ON public.notifications USING btree (created_at DESC);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_order_items_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_order_id ON public.order_items USING btree (order_id);


--
-- Name: idx_order_items_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_order_items_product_id ON public.order_items USING btree (product_id);


--
-- Name: idx_orders_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_created_at ON public.orders USING btree (created_at DESC);


--
-- Name: idx_orders_customer_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_email_trgm ON public.orders USING gin (customer_email public.gin_trgm_ops);


--
-- Name: idx_orders_customer_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_customer_name_trgm ON public.orders USING gin (customer_name public.gin_trgm_ops);


--
-- Name: idx_orders_invoice_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_invoice_number_trgm ON public.orders USING gin (invoice_number public.gin_trgm_ops);


--
-- Name: idx_orders_irn; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_irn ON public.orders USING btree (irn) WHERE (irn IS NOT NULL);


--
-- Name: idx_orders_order_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_order_number ON public.orders USING btree (order_number);


--
-- Name: idx_orders_order_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_order_number_trgm ON public.orders USING gin (order_number public.gin_trgm_ops);


--
-- Name: idx_orders_original_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_original_order_id ON public.orders USING btree (original_order_id);


--
-- Name: idx_orders_payment_link_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_payment_link_id ON public.orders USING btree (payment_link_id) WHERE (payment_link_id IS NOT NULL);


--
-- Name: idx_orders_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_search_vector ON public.orders USING gin (search_vector);


--
-- Name: idx_orders_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_source ON public.orders USING btree (source);


--
-- Name: idx_orders_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_status ON public.orders USING btree (status);


--
-- Name: idx_orders_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_orders_user_id ON public.orders USING btree (user_id);


--
-- Name: idx_otp_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_email ON public.otp_verifications USING btree (email);


--
-- Name: idx_otp_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_otp_expires ON public.otp_verifications USING btree (expires_at);


--
-- Name: idx_page_events_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_events_created_at ON public.page_events USING btree (created_at DESC);


--
-- Name: idx_page_events_page; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_events_page ON public.page_events USING btree (page);


--
-- Name: idx_page_events_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_events_session ON public.page_events USING btree (session_id);


--
-- Name: idx_page_events_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_page_events_user_id ON public.page_events USING btree (user_id);


--
-- Name: idx_payments_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_order_id ON public.payments USING btree (order_id);


--
-- Name: idx_payments_transaction_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_transaction_id ON public.payments USING btree (transaction_id);


--
-- Name: idx_po_number_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_number_trgm ON public.purchase_orders USING gin (po_number public.gin_trgm_ops);


--
-- Name: idx_po_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_status ON public.purchase_orders USING btree (status);


--
-- Name: idx_po_supplier; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_po_supplier ON public.purchase_orders USING btree (supplier_id);


--
-- Name: idx_price_inflation_log_applied_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_inflation_log_applied_at ON public.price_inflation_log USING btree (applied_at DESC);


--
-- Name: idx_price_inflation_log_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_price_inflation_log_category ON public.price_inflation_log USING btree (category_id);


--
-- Name: idx_product_images_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_images_product_id ON public.product_images USING btree (product_id);


--
-- Name: idx_product_variants_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_variants_product_id ON public.product_variants USING btree (product_id);


--
-- Name: idx_product_views_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_views_created_at ON public.product_views USING btree (created_at);


--
-- Name: idx_product_views_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_product_views_product_id ON public.product_views USING btree (product_id);


--
-- Name: idx_products_brand_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_brand_id ON public.products USING btree (brand_id);


--
-- Name: idx_products_category_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_category_id ON public.products USING btree (category_id);


--
-- Name: idx_products_is_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_is_active ON public.products USING btree (is_active);


--
-- Name: idx_products_is_featured; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_is_featured ON public.products USING btree (is_featured);


--
-- Name: idx_products_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_name_trgm ON public.products USING gin (name public.gin_trgm_ops);


--
-- Name: idx_products_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_search_vector ON public.products USING gin (search_vector);


--
-- Name: idx_products_sku; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_sku ON public.products USING btree (sku);


--
-- Name: idx_products_sku_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_sku_trgm ON public.products USING gin (sku public.gin_trgm_ops);


--
-- Name: idx_products_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_products_slug ON public.products USING btree (slug);


--
-- Name: idx_quotation_items_quotation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotation_items_quotation_id ON public.quotation_items USING btree (quotation_id);


--
-- Name: idx_quotations_consignee_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_consignee_name_trgm ON public.quotations USING gin (consignee_name public.gin_trgm_ops);


--
-- Name: idx_quotations_quote_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_quote_date ON public.quotations USING btree (quote_date);


--
-- Name: idx_quotations_search_vector; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_search_vector ON public.quotations USING gin (search_vector);


--
-- Name: idx_quotations_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_quotations_status ON public.quotations USING btree (status);


--
-- Name: idx_return_requests_order_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_return_requests_order_id ON public.return_requests USING btree (order_id);


--
-- Name: idx_return_requests_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_return_requests_status ON public.return_requests USING btree (status);


--
-- Name: idx_return_requests_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_return_requests_user_id ON public.return_requests USING btree (user_id);


--
-- Name: idx_reviews_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_product_id ON public.product_reviews USING btree (product_id);


--
-- Name: idx_reviews_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reviews_user_id ON public.product_reviews USING btree (user_id);


--
-- Name: idx_search_queries_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_search_queries_created_at ON public.search_queries USING btree (created_at);


--
-- Name: idx_sub_variants_product_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_variants_product_id ON public.product_sub_variants USING btree (product_id);


--
-- Name: idx_sub_variants_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sub_variants_variant_id ON public.product_sub_variants USING btree (variant_id);


--
-- Name: idx_suppliers_contact_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_contact_name_trgm ON public.suppliers USING gin (contact_name public.gin_trgm_ops);


--
-- Name: idx_suppliers_gstin_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_gstin_trgm ON public.suppliers USING gin (gstin public.gin_trgm_ops);


--
-- Name: idx_suppliers_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppliers_name_trgm ON public.suppliers USING gin (name public.gin_trgm_ops);


--
-- Name: idx_support_messages_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_messages_session_id ON public.support_messages USING btree (session_id);


--
-- Name: idx_support_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_sessions_status ON public.support_sessions USING btree (status);


--
-- Name: idx_support_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_support_sessions_user_id ON public.support_sessions USING btree (user_id);


--
-- Name: idx_unique_primary_image_per_product; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unique_primary_image_per_product ON public.product_images USING btree (product_id) WHERE (is_primary = true);


--
-- Name: idx_unique_primary_image_per_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_unique_primary_image_per_variant ON public.variant_images USING btree (variant_id) WHERE (is_primary = true);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email_trgm ON public.users USING gin (email public.gin_trgm_ops);


--
-- Name: idx_users_google_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_google_id ON public.users USING btree (google_id);


--
-- Name: idx_users_is_guest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_is_guest ON public.users USING btree (is_guest);


--
-- Name: idx_users_phone_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_phone_trgm ON public.users USING gin (phone public.gin_trgm_ops);


--
-- Name: idx_users_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_session_id ON public.users USING btree (session_id);


--
-- Name: idx_variant_images_variant_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variant_images_variant_id ON public.variant_images USING btree (variant_id);


--
-- Name: idx_variants_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_name_trgm ON public.product_variants USING gin (variant_name public.gin_trgm_ops);


--
-- Name: idx_variants_sku_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variants_sku_trgm ON public.product_variants USING gin (sku public.gin_trgm_ops);


--
-- Name: idx_wishlist_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wishlist_user_id ON public.wishlist_items USING btree (user_id);


--
-- Name: idx_ws_connections_session_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ws_connections_session_id ON public.websocket_connections USING btree (session_id);


--
-- Name: orders_view_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX orders_view_token_idx ON public.orders USING btree (view_token);


--
-- Name: purchase_orders_view_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX purchase_orders_view_token_idx ON public.purchase_orders USING btree (view_token);


--
-- Name: quotations_view_token_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX quotations_view_token_idx ON public.quotations USING btree (view_token);


--
-- Name: review_form_submissions_email_form; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX review_form_submissions_email_form ON public.review_form_submissions USING btree (form_id, email);


-- Module: 15_functions
--
-- Name: cash_sales_search_vector_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cash_sales_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector :=
    to_tsvector('simple', coalesce(NEW.sale_number, '')) ||
    to_tsvector('simple', coalesce(NEW.invoice_number, '')) ||
    to_tsvector('simple', coalesce(NEW.customer_name, ''));
  RETURN NEW;
END;
$$;


--
-- Name: cleanup_old_guest_users(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_old_guest_users(days_old integer DEFAULT 30) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM users
  WHERE is_guest = TRUE
    AND created_at < NOW() - (days_old || ' days')::INTERVAL
    AND id NOT IN (SELECT DISTINCT user_id FROM cart_items)
    AND id NOT IN (SELECT DISTINCT user_id FROM wishlist_items);
END;
$$;


--
-- Name: increment_product_views(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_product_views() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    UPDATE products SET views_count = views_count + 1 WHERE id = NEW.product_id;
    RETURN NEW;
END;
$$;


--
-- Name: merge_guest_cart_to_user(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_guest_cart_to_user(p_guest_user_id uuid, p_actual_user_id uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO cart_items (user_id, product_id, variant_id, quantity, price_at_addition, created_at, updated_at)
  SELECT
    p_actual_user_id,
    product_id,
    variant_id,
    quantity,
    price_at_addition,
    created_at,
    updated_at
  FROM cart_items
  WHERE user_id = p_guest_user_id
  ON CONFLICT (user_id, product_id, variant_id)
  DO UPDATE SET
    quantity = cart_items.quantity + EXCLUDED.quantity,
    updated_at = NOW();

  DELETE FROM cart_items WHERE user_id = p_guest_user_id;

  INSERT INTO wishlist_items (user_id, product_id, created_at)
  SELECT
    p_actual_user_id,
    product_id,
    created_at
  FROM wishlist_items
  WHERE user_id = p_guest_user_id
  ON CONFLICT (user_id, product_id) DO NOTHING;

  DELETE FROM wishlist_items WHERE user_id = p_guest_user_id;

  UPDATE users
  SET
    merged_to_user_id = p_actual_user_id,
    updated_at = NOW()
  WHERE id = p_guest_user_id;
END;
$$;


--
-- Name: orders_search_vector_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.orders_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.order_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.invoice_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.customer_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.customer_email, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.customer_phone, '')), 'B');
  RETURN NEW;
END
$$;


--
-- Name: products_search_vector_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.products_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.sku, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.short_description, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'D');
  RETURN NEW;
END
$$;


--
-- Name: quotations_search_vector_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.quotations_search_vector_update() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.quote_number, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.consignee_name, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.consignee_gstin, '')), 'B') ||
    setweight(to_tsvector('simple', coalesce(NEW.buyer_name, '')), 'C');
  RETURN NEW;
END
$$;


--
-- Name: update_product_search_vector(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_product_search_vector() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('english', COALESCE(NEW.name, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(NEW.description, '')), 'B') ||
        setweight(to_tsvector('english', COALESCE(NEW.sku, '')), 'C');
    RETURN NEW;
END;
$$;


--
-- Name: update_product_stock_status(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_product_stock_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.is_in_stock := NEW.stock_quantity > 0;
    RETURN NEW;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


--
-- Name: validate_product_image_limit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.validate_product_image_limit() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
    image_count INT;
BEGIN
    SELECT COUNT(*) INTO image_count
    FROM product_images
    WHERE product_id = NEW.product_id;

    IF image_count >= 5 THEN
        RAISE EXCEPTION 'Cannot add more than 5 images per product';
    END IF;

    RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

-- Module: 16_triggers
--
-- Name: product_images check_product_image_limit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER check_product_image_limit BEFORE INSERT ON public.product_images FOR EACH ROW EXECUTE FUNCTION public.validate_product_image_limit();


--
-- Name: product_views increment_product_views_trigger; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER increment_product_views_trigger AFTER INSERT ON public.product_views FOR EACH ROW EXECUTE FUNCTION public.increment_product_views();


--
-- Name: orders orders_search_vector_trig; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER orders_search_vector_trig BEFORE INSERT OR UPDATE OF order_number, invoice_number, customer_name, customer_email, customer_phone ON public.orders FOR EACH ROW EXECUTE FUNCTION public.orders_search_vector_update();


--
-- Name: products products_search_vector_trig; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER products_search_vector_trig BEFORE INSERT OR UPDATE OF name, sku, short_description, description ON public.products FOR EACH ROW EXECUTE FUNCTION public.products_search_vector_update();


--
-- Name: quotations quotations_search_vector_trig; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER quotations_search_vector_trig BEFORE INSERT OR UPDATE OF quote_number, consignee_name, consignee_gstin, buyer_name ON public.quotations FOR EACH ROW EXECUTE FUNCTION public.quotations_search_vector_update();


--
-- Name: cash_sales trig_cash_sales_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trig_cash_sales_search_vector BEFORE INSERT OR UPDATE ON public.cash_sales FOR EACH ROW EXECUTE FUNCTION public.cash_sales_search_vector_update();


--
-- Name: addresses update_addresses_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_addresses_updated_at BEFORE UPDATE ON public.addresses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: categories update_categories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON public.categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: customer_profiles update_customer_profiles_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_customer_profiles_updated_at BEFORE UPDATE ON public.customer_profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: orders update_orders_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: product_images update_product_images_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_product_images_updated_at BEFORE UPDATE ON public.product_images FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: products update_products_search_vector; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_search_vector BEFORE INSERT OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_product_search_vector();


--
-- Name: products update_products_stock_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_stock_status BEFORE INSERT OR UPDATE OF stock_quantity ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_product_stock_status();


--
-- Name: products update_products_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Module: 17_views
-- Module: 18_constraints
--
-- Name: addresses addresses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_pkey PRIMARY KEY (id);


--
-- Name: admin_certificates admin_certificates_download_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_certificates
    ADD CONSTRAINT admin_certificates_download_token_key UNIQUE (download_token);


--
-- Name: admin_certificates admin_certificates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_certificates
    ADD CONSTRAINT admin_certificates_pkey PRIMARY KEY (id);


--
-- Name: admin_certificates admin_certificates_serial_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_certificates
    ADD CONSTRAINT admin_certificates_serial_number_key UNIQUE (serial_number);


--
-- Name: admins admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_pkey PRIMARY KEY (id);


--
-- Name: admins admins_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_username_key UNIQUE (username);


--
-- Name: brands brands_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_name_key UNIQUE (name);


--
-- Name: brands brands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);


--
-- Name: brands brands_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_slug_key UNIQUE (slug);


--
-- Name: cart_items cart_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_pkey PRIMARY KEY (id);


--
-- Name: cart_items cart_items_user_id_product_id_variant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_user_id_product_id_variant_id_key UNIQUE (user_id, product_id, variant_id);


--
-- Name: cash_sale_items cash_sale_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sale_items
    ADD CONSTRAINT cash_sale_items_pkey PRIMARY KEY (id);


--
-- Name: cash_sales cash_sales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sales
    ADD CONSTRAINT cash_sales_pkey PRIMARY KEY (id);


--
-- Name: cash_sales cash_sales_sale_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sales
    ADD CONSTRAINT cash_sales_sale_number_key UNIQUE (sale_number);


--
-- Name: categories categories_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_name_key UNIQUE (name);


--
-- Name: categories categories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);


--
-- Name: categories categories_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_slug_key UNIQUE (slug);


--
-- Name: coupon_usage coupon_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_usage
    ADD CONSTRAINT coupon_usage_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: customer_profiles customer_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_pkey PRIMARY KEY (id);


--
-- Name: delhivery_pickup_requests delhivery_pickup_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.delhivery_pickup_requests
    ADD CONSTRAINT delhivery_pickup_requests_pkey PRIMARY KEY (id);


--
-- Name: email_campaign_logs email_campaign_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_logs
    ADD CONSTRAINT email_campaign_logs_pkey PRIMARY KEY (id);


--
-- Name: email_campaigns email_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_pkey PRIMARY KEY (id);


--
-- Name: email_logs email_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_pkey PRIMARY KEY (id);


--
-- Name: expense_payments expense_payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_pkey PRIMARY KEY (id);


--
-- Name: expenses expenses_expense_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_expense_number_key UNIQUE (expense_number);


--
-- Name: expenses expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_pkey PRIMARY KEY (id);


--
-- Name: gallery_images gallery_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_images
    ADD CONSTRAINT gallery_images_pkey PRIMARY KEY (id);


--
-- Name: grn_items grn_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_pkey PRIMARY KEY (id);


--
-- Name: grns grns_grn_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grns
    ADD CONSTRAINT grns_grn_number_key UNIQUE (grn_number);


--
-- Name: grns grns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grns
    ADD CONSTRAINT grns_pkey PRIMARY KEY (id);


--
-- Name: inventory_transactions inventory_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_financial_year_sequence_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_financial_year_sequence_number_key UNIQUE (financial_year, sequence_number);


--
-- Name: invoices invoices_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_invoice_number_key UNIQUE (invoice_number);


--
-- Name: invoices invoices_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_order_id_key UNIQUE (order_id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: order_status_history order_status_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_pkey PRIMARY KEY (id);


--
-- Name: orders orders_invoice_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_invoice_number_key UNIQUE (invoice_number);


--
-- Name: orders orders_order_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_order_number_key UNIQUE (order_number);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: otp_verifications otp_verifications_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT otp_verifications_email_key UNIQUE (email);


--
-- Name: otp_verifications otp_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.otp_verifications
    ADD CONSTRAINT otp_verifications_pkey PRIMARY KEY (id);


--
-- Name: page_events page_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_events
    ADD CONSTRAINT page_events_pkey PRIMARY KEY (id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_transaction_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_transaction_id_key UNIQUE (transaction_id);


--
-- Name: price_inflation_log price_inflation_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_inflation_log
    ADD CONSTRAINT price_inflation_log_pkey PRIMARY KEY (id);


--
-- Name: product_images product_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_pkey PRIMARY KEY (id);


--
-- Name: product_reviews product_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_pkey PRIMARY KEY (id);


--
-- Name: product_sub_variants product_sub_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sub_variants
    ADD CONSTRAINT product_sub_variants_pkey PRIMARY KEY (id);


--
-- Name: product_sub_variants product_sub_variants_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sub_variants
    ADD CONSTRAINT product_sub_variants_sku_key UNIQUE (sku);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_sku_key UNIQUE (sku);


--
-- Name: product_views product_views_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_views
    ADD CONSTRAINT product_views_pkey PRIMARY KEY (id);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: products products_sku_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_sku_key UNIQUE (sku);


--
-- Name: products products_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_slug_key UNIQUE (slug);


--
-- Name: purchase_order_items purchase_order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);


--
-- Name: purchase_orders purchase_orders_po_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number);


--
-- Name: quotation_items quotation_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_pkey PRIMARY KEY (id);


--
-- Name: quotations quotations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_pkey PRIMARY KEY (id);


--
-- Name: quotations quotations_quote_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_quote_number_key UNIQUE (quote_number);


--
-- Name: return_requests return_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_requests
    ADD CONSTRAINT return_requests_pkey PRIMARY KEY (id);


--
-- Name: review_form_submissions review_form_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_form_submissions
    ADD CONSTRAINT review_form_submissions_pkey PRIMARY KEY (id);


--
-- Name: review_forms review_forms_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_forms
    ADD CONSTRAINT review_forms_pkey PRIMARY KEY (id);


--
-- Name: review_forms review_forms_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_forms
    ADD CONSTRAINT review_forms_slug_key UNIQUE (slug);


--
-- Name: search_queries search_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_queries
    ADD CONSTRAINT search_queries_pkey PRIMARY KEY (id);


--
-- Name: shipping_zones shipping_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shipping_zones
    ADD CONSTRAINT shipping_zones_pkey PRIMARY KEY (id);


--
-- Name: site_settings site_settings_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_key_key UNIQUE (key);


--
-- Name: site_settings site_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_pkey PRIMARY KEY (id);


--
-- Name: suppliers suppliers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);


--
-- Name: support_messages support_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_pkey PRIMARY KEY (id);


--
-- Name: support_sessions support_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_sessions
    ADD CONSTRAINT support_sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_google_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_google_id_key UNIQUE (google_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_session_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_session_id_key UNIQUE (session_id);


--
-- Name: variant_images variant_images_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_images
    ADD CONSTRAINT variant_images_pkey PRIMARY KEY (id);


--
-- Name: websocket_connections websocket_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websocket_connections
    ADD CONSTRAINT websocket_connections_pkey PRIMARY KEY (connection_id);


--
-- Name: wishlist_items wishlist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlist_items
    ADD CONSTRAINT wishlist_items_pkey PRIMARY KEY (id);


--
-- Name: wishlist_items wishlist_items_user_id_product_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlist_items
    ADD CONSTRAINT wishlist_items_user_id_product_id_key UNIQUE (user_id, product_id);


--
-- Name: addresses addresses_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addresses
    ADD CONSTRAINT addresses_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: admin_certificates admin_certificates_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_certificates
    ADD CONSTRAINT admin_certificates_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;


--
-- Name: admins admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admins
    ADD CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: cart_items cart_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: cart_items cart_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: cart_items cart_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cart_items
    ADD CONSTRAINT cart_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: cash_sale_items cash_sale_items_sale_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cash_sale_items
    ADD CONSTRAINT cash_sale_items_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.cash_sales(id) ON DELETE CASCADE;


--
-- Name: categories categories_parent_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_category_id_fkey FOREIGN KEY (parent_category_id) REFERENCES public.categories(id);


--
-- Name: coupon_usage coupon_usage_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_usage
    ADD CONSTRAINT coupon_usage_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


--
-- Name: coupon_usage coupon_usage_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_usage
    ADD CONSTRAINT coupon_usage_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: coupon_usage coupon_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupon_usage
    ADD CONSTRAINT coupon_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: customer_profiles customer_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.customer_profiles
    ADD CONSTRAINT customer_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: email_campaign_logs email_campaign_logs_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_logs
    ADD CONSTRAINT email_campaign_logs_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.email_campaigns(id) ON DELETE CASCADE;


--
-- Name: email_campaigns email_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id) ON DELETE SET NULL;


--
-- Name: email_logs email_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_logs
    ADD CONSTRAINT email_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: expense_payments expense_payments_expense_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expense_payments
    ADD CONSTRAINT expense_payments_expense_id_fkey FOREIGN KEY (expense_id) REFERENCES public.expenses(id) ON DELETE CASCADE;


--
-- Name: expenses expenses_grn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.grns(id) ON DELETE SET NULL;


--
-- Name: expenses expenses_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.expenses
    ADD CONSTRAINT expenses_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE SET NULL;


--
-- Name: gallery_images gallery_images_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.gallery_images
    ADD CONSTRAINT gallery_images_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: grn_items grn_items_grn_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_grn_id_fkey FOREIGN KEY (grn_id) REFERENCES public.grns(id) ON DELETE CASCADE;


--
-- Name: grn_items grn_items_po_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_po_item_id_fkey FOREIGN KEY (po_item_id) REFERENCES public.purchase_order_items(id) ON DELETE RESTRICT;


--
-- Name: grn_items grn_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: grn_items grn_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grn_items
    ADD CONSTRAINT grn_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id);


--
-- Name: grns grns_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grns
    ADD CONSTRAINT grns_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE RESTRICT;


--
-- Name: grns grns_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grns
    ADD CONSTRAINT grns_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: inventory_transactions inventory_transactions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: inventory_transactions inventory_transactions_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: inventory_transactions inventory_transactions_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_transactions
    ADD CONSTRAINT inventory_transactions_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: order_items order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: order_status_history order_status_history_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id);


--
-- Name: order_status_history order_status_history_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.order_status_history
    ADD CONSTRAINT order_status_history_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: orders orders_billing_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_billing_address_id_fkey FOREIGN KEY (billing_address_id) REFERENCES public.addresses(id);


--
-- Name: orders orders_original_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_original_order_id_fkey FOREIGN KEY (original_order_id) REFERENCES public.orders(id);


--
-- Name: orders orders_shipping_address_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shipping_address_id_fkey FOREIGN KEY (shipping_address_id) REFERENCES public.addresses(id);


--
-- Name: orders orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: page_events page_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.page_events
    ADD CONSTRAINT page_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: payments payments_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: price_inflation_log price_inflation_log_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.price_inflation_log
    ADD CONSTRAINT price_inflation_log_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: product_images product_images_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_images
    ADD CONSTRAINT product_images_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_reviews product_reviews_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_reviews product_reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_reviews
    ADD CONSTRAINT product_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: product_sub_variants product_sub_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sub_variants
    ADD CONSTRAINT product_sub_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_sub_variants product_sub_variants_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_sub_variants
    ADD CONSTRAINT product_sub_variants_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_views product_views_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_views
    ADD CONSTRAINT product_views_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: product_views product_views_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.product_views
    ADD CONSTRAINT product_views_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: products products_brand_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_brand_id_fkey FOREIGN KEY (brand_id) REFERENCES public.brands(id) ON DELETE SET NULL;


--
-- Name: products products_category_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.categories(id);


--
-- Name: purchase_order_items purchase_order_items_po_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_po_id_fkey FOREIGN KEY (po_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;


--
-- Name: purchase_order_items purchase_order_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;


--
-- Name: purchase_order_items purchase_order_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_order_items
    ADD CONSTRAINT purchase_order_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE RESTRICT;


--
-- Name: purchase_orders purchase_orders_supplier_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE RESTRICT;


--
-- Name: quotation_items quotation_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: quotation_items quotation_items_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_quotation_id_fkey FOREIGN KEY (quotation_id) REFERENCES public.quotations(id) ON DELETE CASCADE;


--
-- Name: quotation_items quotation_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotation_items
    ADD CONSTRAINT quotation_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;


--
-- Name: quotations quotations_converted_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_converted_order_id_fkey FOREIGN KEY (converted_order_id) REFERENCES public.orders(id) ON DELETE SET NULL;


--
-- Name: quotations quotations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.quotations
    ADD CONSTRAINT quotations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id) ON DELETE SET NULL;


--
-- Name: return_requests return_requests_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_requests
    ADD CONSTRAINT return_requests_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: return_requests return_requests_replacement_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_requests
    ADD CONSTRAINT return_requests_replacement_order_id_fkey FOREIGN KEY (replacement_order_id) REFERENCES public.orders(id);


--
-- Name: return_requests return_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.return_requests
    ADD CONSTRAINT return_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: review_form_submissions review_form_submissions_form_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_form_submissions
    ADD CONSTRAINT review_form_submissions_form_id_fkey FOREIGN KEY (form_id) REFERENCES public.review_forms(id) ON DELETE CASCADE;


--
-- Name: review_forms review_forms_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_forms
    ADD CONSTRAINT review_forms_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE SET NULL;


--
-- Name: search_queries search_queries_clicked_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_queries
    ADD CONSTRAINT search_queries_clicked_product_id_fkey FOREIGN KEY (clicked_product_id) REFERENCES public.products(id) ON DELETE SET NULL;


--
-- Name: search_queries search_queries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_queries
    ADD CONSTRAINT search_queries_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: site_settings site_settings_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.site_settings
    ADD CONSTRAINT site_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id);


--
-- Name: support_messages support_messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_messages
    ADD CONSTRAINT support_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.support_sessions(id) ON DELETE CASCADE;


--
-- Name: support_sessions support_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.support_sessions
    ADD CONSTRAINT support_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_merged_to_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_merged_to_user_id_fkey FOREIGN KEY (merged_to_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: variant_images variant_images_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variant_images
    ADD CONSTRAINT variant_images_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE CASCADE;


--
-- Name: websocket_connections websocket_connections_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websocket_connections
    ADD CONSTRAINT websocket_connections_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.support_sessions(id) ON DELETE CASCADE;


--
-- Name: websocket_connections websocket_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.websocket_connections
    ADD CONSTRAINT websocket_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: wishlist_items wishlist_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlist_items
    ADD CONSTRAINT wishlist_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: wishlist_items wishlist_items_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wishlist_items
    ADD CONSTRAINT wishlist_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict sApkcCOWPvYzNoz8yqPDF7aYvaKpmJ9edr7JeDtXwMb8moDXhiz5HfOtkSAhIc6

