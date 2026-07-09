-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl



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
    created_at timestamp with time zone DEFAULT now(),
    return_allowed boolean DEFAULT true NOT NULL,
    return_window_days integer DEFAULT 7 NOT NULL,
    replacement_allowed boolean DEFAULT true NOT NULL,
    replacement_window_days integer DEFAULT 7 NOT NULL
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
    icon_name character varying(100),
    return_allowed boolean DEFAULT true,
    return_window_days integer DEFAULT 7,
    replacement_allowed boolean DEFAULT true,
    replacement_window_days integer DEFAULT 7,
    hero_image_mobile text,
    hero_image_desktop text
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
    attributes jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    inventory_quantity numeric(14,3) DEFAULT 0 NOT NULL,
    discount_pct numeric(5,2) DEFAULT 0 NOT NULL,
    stock_status character varying(20) DEFAULT 'In Stock'::character varying NOT NULL,
    CONSTRAINT product_sub_variants_stock_status_check CHECK (((stock_status)::text = ANY ((ARRAY['In Stock'::character varying, 'Low Stock'::character varying, 'Out of Stock'::character varying])::text[])))
);



--
-- Name: product_unit_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_unit_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_unit_id uuid NOT NULL,
    rule_type text NOT NULL,
    config jsonb NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_unit_rules_rule_type_check CHECK ((rule_type = ANY (ARRAY['tiered_price'::text, 'gst_threshold'::text, 'bonus_qty'::text, 'bundle_split'::text, 'physical_variance'::text])))
);



--
-- Name: product_units; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.product_units (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid,
    unit character varying(20) NOT NULL,
    factor numeric(14,6) NOT NULL,
    is_base boolean DEFAULT false NOT NULL,
    is_purchase_default boolean DEFAULT false NOT NULL,
    price_override numeric(14,4),
    display_label character varying(80),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    dimension character varying(20) DEFAULT 'count'::character varying NOT NULL,
    conversion_meta jsonb,
    sub_variant_id uuid,
    min_qty numeric(14,4) DEFAULT 1 NOT NULL,
    max_qty numeric(14,4),
    qty_step numeric(14,4) DEFAULT 1 NOT NULL,
    CONSTRAINT product_units_dimension_check CHECK (((dimension)::text = ANY ((ARRAY['count'::character varying, 'length'::character varying, 'area'::character varying, 'volume'::character varying, 'weight'::character varying, 'custom'::character varying])::text[]))),
    CONSTRAINT product_units_factor_check CHECK ((factor > (0)::numeric))
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
    attributes jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    mrp numeric(12,2),
    price_ex_gst numeric(12,2),
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
    inventory_quantity numeric(14,3) DEFAULT 0 NOT NULL,
    mrp_ex_gst numeric(12,2),
    variant_type character varying(100),
    sub_variant_type text,
    sub_variant_type_on boolean DEFAULT false NOT NULL,
    use_own_images boolean DEFAULT false NOT NULL,
    discount_pct numeric(5,2) DEFAULT 0 NOT NULL,
    stock_decimal_precision smallint DEFAULT 0 NOT NULL,
    sell_unit_id uuid,
    stock_status character varying(20) DEFAULT 'In Stock'::character varying NOT NULL,
    CONSTRAINT product_variants_stock_status_check CHECK (((stock_status)::text = ANY ((ARRAY['In Stock'::character varying, 'Low Stock'::character varying, 'Out of Stock'::character varying])::text[])))
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
    currency character varying(10) DEFAULT 'INR'::character varying,
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
    extra_delivery_days integer DEFAULT 0 NOT NULL,
    inventory_quantity numeric(14,3) DEFAULT 0 NOT NULL,
    mrp_ex_gst numeric(12,2),
    sub_variant_type character varying(100),
    ai_description text,
    ai_use_cases text[],
    ai_enriched_at timestamp with time zone,
    ai_keywords text[],
    ai_who_uses_it text,
    ai_application text,
    ai_product_type text,
    ai_features text[],
    ai_search_tags text[],
    discount_pct numeric(5,2) DEFAULT 0 NOT NULL,
    sell_unit_id uuid,
    stock_status character varying(20) DEFAULT 'In Stock'::character varying NOT NULL,
    -- Identification & Compliance
    barcode character varying(50),
    isbn character varying(20),
    asin character varying(20),
    brand_part_number character varying(100),
    country_of_origin character varying(2),
    shelf_life_days integer,
    -- Physical Attributes
    color character varying(100),
    color_hex character varying(7),
    volume_ml numeric(10,2),
    net_weight_grams integer,
    fragile boolean DEFAULT false NOT NULL,
    hazardous boolean DEFAULT false NOT NULL,
    flammable boolean DEFAULT false NOT NULL,
    perishable boolean DEFAULT false NOT NULL,
    -- Certifications & Standards
    certifications text[],
    compliance_standard character varying(100),
    safety_rating character varying(100),
    warranty_months integer,
    warranty_type character varying(30),
    -- Condition & Lifecycle
    condition character varying(20) DEFAULT 'new' NOT NULL,
    is_cod_allowed boolean DEFAULT false NOT NULL,
    launch_date date,
    discontinue_date date,
    sort_order integer DEFAULT 0 NOT NULL,
    -- Shipping & Logistics
    handling_days integer DEFAULT 2 NOT NULL,
    shipping_class character varying(30) DEFAULT 'standard' NOT NULL,
    is_oversized boolean DEFAULT false NOT NULL,
    volumetric_weight_grams integer,
    -- Digital / Content
    is_digital boolean DEFAULT false NOT NULL,
    download_url text,
    license_type character varying(30),
    file_format character varying(50),
    platform_compatibility text[],
    -- Subscriptions
    is_subscription boolean DEFAULT false NOT NULL,
    subscription_interval character varying(20),
    subscription_price numeric(12,2),
    -- Bundling
    is_bundle boolean DEFAULT false NOT NULL,
    bundle_items jsonb,
    -- SEO & Merchandising
    meta_title character varying(160),
    meta_description character varying(320),
    meta_keywords text[],
    is_searchable boolean DEFAULT true NOT NULL,
    -- Tax & Finance
    tax_class character varying(30) DEFAULT 'standard' NOT NULL,
    customs_tariff_code character varying(20),
    inclusive_tax boolean DEFAULT false NOT NULL,
    -- Age / Audience
    age_min integer,
    age_max integer,
    target_gender character varying(20),
    target_audience text[],
    CONSTRAINT products_stock_status_check CHECK (((stock_status)::text = ANY ((ARRAY['In Stock'::character varying, 'Low Stock'::character varying, 'Out of Stock'::character varying])::text[])))
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


-- Live migration (idempotent)
ALTER TABLE products ADD COLUMN IF NOT EXISTS extra_delivery_days integer DEFAULT 0 NOT NULL;
-- Drop stale non-partial unique constraint superseded by partial indexes uniq_product_units_product_unit + uniq_product_units_variant_unit
ALTER TABLE product_units DROP CONSTRAINT IF EXISTS product_units_product_id_unit_key;

-- Generic catalog expansion migrations (idempotent)
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode character varying(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS isbn character varying(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS asin character varying(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_part_number character varying(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS country_of_origin character varying(2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS shelf_life_days integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS color character varying(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS color_hex character varying(7);
ALTER TABLE products ADD COLUMN IF NOT EXISTS volume_ml numeric(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS net_weight_grams integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS fragile boolean DEFAULT false NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS hazardous boolean DEFAULT false NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS flammable boolean DEFAULT false NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS perishable boolean DEFAULT false NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS certifications text[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS compliance_standard character varying(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS safety_rating character varying(100);
ALTER TABLE products ADD COLUMN IF NOT EXISTS warranty_months integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS warranty_type character varying(30);
ALTER TABLE products ADD COLUMN IF NOT EXISTS condition character varying(20) DEFAULT 'new' NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_cod_allowed boolean DEFAULT false NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS launch_date date;
ALTER TABLE products ADD COLUMN IF NOT EXISTS discontinue_date date;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS handling_days integer DEFAULT 2 NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS shipping_class character varying(30) DEFAULT 'standard' NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_oversized boolean DEFAULT false NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS volumetric_weight_grams integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_digital boolean DEFAULT false NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS download_url text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS license_type character varying(30);
ALTER TABLE products ADD COLUMN IF NOT EXISTS file_format character varying(50);
ALTER TABLE products ADD COLUMN IF NOT EXISTS platform_compatibility text[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_subscription boolean DEFAULT false NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS subscription_interval character varying(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS subscription_price numeric(12,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_bundle boolean DEFAULT false NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS bundle_items jsonb;
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_title character varying(160);
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_description character varying(320);
ALTER TABLE products ADD COLUMN IF NOT EXISTS meta_keywords text[];
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_searchable boolean DEFAULT true NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tax_class character varying(30) DEFAULT 'standard' NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS customs_tariff_code character varying(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS inclusive_tax boolean DEFAULT false NOT NULL;
ALTER TABLE products ADD COLUMN IF NOT EXISTS age_min integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS age_max integer;
ALTER TABLE products ADD COLUMN IF NOT EXISTS target_gender character varying(20);
ALTER TABLE products ADD COLUMN IF NOT EXISTS target_audience text[];

-- product_batches: per-intake batch tracking (manufacture/expiry dates, lot numbers)
CREATE TABLE IF NOT EXISTS public.product_batches (
    id               uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id       uuid NOT NULL,
    variant_id       uuid,
    sub_variant_id   uuid,
    lot_number       character varying(100),
    manufacture_date date,
    expiry_date      date,
    quantity         numeric(14,3) DEFAULT 0 NOT NULL,
    notes            text,
    created_at       timestamp with time zone DEFAULT now() NOT NULL,
    updated_at       timestamp with time zone DEFAULT now() NOT NULL
);

-- Update column defaults for is_cod_allowed and handling_days
ALTER TABLE products ALTER COLUMN is_cod_allowed SET DEFAULT false;
ALTER TABLE products ALTER COLUMN handling_days SET DEFAULT 2;

-- product_batches: add grn traceability, FIFO remaining qty, and shelf location
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS grn_id uuid REFERENCES grns(id);
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS quantity_remaining numeric(14,3) NOT NULL DEFAULT 0;
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES shelf_locations(id);

-- order_items: link to assigned batch (set at stock deduction time)
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL;

-- inventory_transactions: full batch audit trail
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES product_batches(id) ON DELETE SET NULL;

-- snapshot columns: store lot_number, expiry_date, serial_number at write time so ledger is immutable
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS lot_number varchar(100);
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS expiry_date date;
ALTER TABLE inventory_transactions ADD COLUMN IF NOT EXISTS serial_number varchar(100);

-- serialized flag: products whose individual units get unique serial numbers
ALTER TABLE products ADD COLUMN IF NOT EXISTS serialized boolean DEFAULT false NOT NULL;

-- product_serials: unique unit tracking per serialized product
CREATE TABLE IF NOT EXISTS public.product_serials (
    id               uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id       uuid NOT NULL,
    variant_id       uuid,
    sub_variant_id   uuid,
    batch_id         uuid REFERENCES product_batches(id) ON DELETE SET NULL,
    grn_id           uuid REFERENCES grns(id) ON DELETE SET NULL,
    serial_number    character varying(100) NOT NULL,
    status           character varying(20) DEFAULT 'in_stock' NOT NULL,
    order_id         uuid,
    order_item_id    uuid,
    notes            text,
    received_at      timestamp with time zone DEFAULT now() NOT NULL,
    sold_at          timestamp with time zone,
    returned_at      timestamp with time zone,
    created_at       timestamp with time zone DEFAULT now() NOT NULL,
    updated_at       timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT product_serials_status_check CHECK (status = ANY (ARRAY['in_stock', 'sold', 'returned', 'damaged', 'lost']))
);
