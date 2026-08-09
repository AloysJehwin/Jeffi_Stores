-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: grn_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grn_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    grn_id uuid,
    po_item_id uuid,
    product_id uuid,
    variant_id uuid,
    quantity_received numeric(14,3) NOT NULL,
    unit_cost numeric(12,2) NOT NULL,
    purchase_unit_factor numeric(14,6) DEFAULT 1 NOT NULL
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
    quantity_change numeric(14,3) NOT NULL,
    quantity_after numeric(14,3) NOT NULL,
    reference_type character varying(50),
    reference_id uuid,
    notes text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    sub_variant_id uuid,
    unit_id uuid,
    unit_label character varying(80),
    unit_factor numeric(14,6),
    quantity_in_unit numeric(14,6),
    lot_number character varying(100),
    expiry_date date,
    serial_number character varying(100),
    batch_id uuid
);


--
-- Name: shelf_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shelf_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    warehouse_id uuid NOT NULL,
    aisle_code text NOT NULL,
    rack_code text NOT NULL,
    shelf_code text NOT NULL,
    bin_code text,
    display_code text NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shelf_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shelf_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    sub_variant_id uuid,
    quantity integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: shelf_stock_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shelf_stock_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid,
    product_id uuid NOT NULL,
    variant_id uuid,
    sub_variant_id uuid,
    quantity_change integer NOT NULL,
    quantity_after integer NOT NULL,
    reason text,
    reference_id uuid,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: warehouses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    code text NOT NULL,
    address text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: product_suppliers; Type: TABLE; Schema: public; Owner: -
--
-- Leaf-level supplier links: suppliers + quoted buy price attach at the sellable
-- leaf — product (simple), variant (has variants), or sub-variant (has sub-variants).
-- At most one of variant_id/sub_variant_id is set (CHECK); simple products set neither.
-- Dated rows (one INSERT per price change) give a lightweight quote history; the
-- "current" price per supplier at a leaf is the latest effective_date. The preferred
-- row (per leaf) is denormalized onto products/variants.supplier_id on publish where
-- applicable. Actual purchase history lives in purchase_order_items.

CREATE TABLE public.product_suppliers (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    sub_variant_id uuid,
    supplier_id uuid NOT NULL,
    unit_cost numeric(12,2) NOT NULL,
    currency character varying(3) DEFAULT 'INR'::character varying NOT NULL,
    gst_inclusive boolean DEFAULT false,
    moq numeric(12,2),
    lead_time_days integer,
    is_preferred boolean DEFAULT false NOT NULL,
    effective_date date DEFAULT CURRENT_DATE NOT NULL,
    notes text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
