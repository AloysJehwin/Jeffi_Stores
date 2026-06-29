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

