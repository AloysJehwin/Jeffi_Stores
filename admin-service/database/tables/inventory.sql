-- admin-service: tables. Load order comes from scripts/db-files.mjs.

--
-- Name: shelf_stock; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shelf_stock (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    location_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    sub_variant_id uuid,
    quantity numeric(14,3) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
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
    purchase_unit character varying(50),
    purchase_unit_factor numeric(14,6) DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
