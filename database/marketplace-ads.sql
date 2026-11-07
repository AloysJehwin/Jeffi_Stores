--
-- Myntra Ads and AJIO Ads (lib/marketplace-ads): report imports keyed by channel (myntra, ajio).
-- Neither marketplace has an ads API, so rows come from uploaded reports; an import replaces the
-- channel's rows for the report's date range, so re-uploading the same report is safe.
--

--
-- Name: marketplace_ad_daily; Type: TABLE; Schema: public; Owner: -
-- Campaign report rows, one per (channel, date, campaign, ad group). campaign_key is the campaign
-- id, or the name when the report has no id.
--

CREATE TABLE public.marketplace_ad_daily (
    channel character varying(16) NOT NULL,
    date date NOT NULL,
    campaign_key text NOT NULL,
    campaign_id text,
    campaign_name text,
    ad_group text DEFAULT ''::text NOT NULL,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    spend numeric(14,2) DEFAULT 0 NOT NULL,
    orders integer DEFAULT 0 NOT NULL,
    units integer DEFAULT 0 NOT NULL,
    sales numeric(14,2) DEFAULT 0 NOT NULL,
    import_id uuid
);


--
-- Name: marketplace_ad_products; Type: TABLE; Schema: public; Owner: -
-- Product report rows, one per (channel, date, campaign, product). product_key is the SKU, or the
-- style id when the report has no SKU; product_id/variant_id/sub_variant_id are the catalogue match
-- at import time (lib/marketplace/match.ts).
--

CREATE TABLE public.marketplace_ad_products (
    channel character varying(16) NOT NULL,
    date date NOT NULL,
    campaign_key text DEFAULT ''::text NOT NULL,
    campaign_name text,
    product_key text NOT NULL,
    sku text,
    style_id text,
    product_name text,
    product_id uuid,
    variant_id uuid,
    sub_variant_id uuid,
    impressions bigint DEFAULT 0 NOT NULL,
    clicks bigint DEFAULT 0 NOT NULL,
    spend numeric(14,2) DEFAULT 0 NOT NULL,
    orders integer DEFAULT 0 NOT NULL,
    units integer DEFAULT 0 NOT NULL,
    sales numeric(14,2) DEFAULT 0 NOT NULL,
    import_id uuid
);


--
-- Name: marketplace_ad_imports; Type: TABLE; Schema: public; Owner: -
-- One row per committed report: who, which file, the range it replaced and the column mapping used
-- (the latest mappings are offered again for the next file).
--

CREATE TABLE public.marketplace_ad_imports (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    channel character varying(16) NOT NULL,
    kind character varying(16) NOT NULL,
    file_name text,
    date_from date NOT NULL,
    date_to date NOT NULL,
    row_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    replaced_count integer DEFAULT 0 NOT NULL,
    mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    totals jsonb DEFAULT '{}'::jsonb NOT NULL,
    imported_by uuid,
    imported_by_email text,
    imported_at timestamp with time zone DEFAULT now() NOT NULL
);
