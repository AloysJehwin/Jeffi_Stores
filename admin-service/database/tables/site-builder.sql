--
-- Site Builder: block-built pages (the header, footer and announcement bar are site-wide pages), the theme, drafts,
-- published history, assets and saved templates. One document per (audience, surface, page): nothing set on one layout changes
-- another. See docs/SITE_BUILDER_PLAN.md.
--

--
-- Name: site_pages; Type: TABLE; Schema: public; Owner: -
-- The published document of one page on one layout. Drafts live in site_drafts until published here.
--

CREATE TABLE public.site_pages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audience character varying(10) DEFAULT 'store'::character varying NOT NULL,
    surface character varying(12) DEFAULT 'web'::character varying NOT NULL,
    page_key character varying(32) NOT NULL,
    slug character varying(120) DEFAULT ''::character varying NOT NULL,
    title character varying(200),
    seo jsonb DEFAULT '{}'::jsonb NOT NULL,
    published_doc jsonb DEFAULT '{"schemaVersion": 1, "blocks": {}, "order": []}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    published_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: site_theme; Type: TABLE; Schema: public; Owner: -
-- The published theme (colours, fonts, shape) per audience.
--

CREATE TABLE public.site_theme (
    audience character varying(10) DEFAULT 'store'::character varying NOT NULL,
    tokens jsonb DEFAULT '{}'::jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    published_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: site_drafts; Type: TABLE; Schema: public; Owner: -
-- An editor's working copy of any set of pages, groups and the theme. `docs` holds the edited documents
-- ({ pages: { <audience:surface:page:slug>: doc }, theme: { <audience>: tokens } });
-- `base` the published versions they started from, for the three-way merge on publish.
--

CREATE TABLE public.site_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(120),
    author_admin_id uuid,
    docs jsonb DEFAULT '{}'::jsonb NOT NULL,
    base jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: site_versions; Type: TABLE; Schema: public; Owner: -
-- Every published version of a page or theme, for history and one-click rollback (the last 20 are kept).
--

CREATE TABLE public.site_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target character varying(10) NOT NULL,
    target_key character varying(200) NOT NULL,
    version integer NOT NULL,
    doc jsonb NOT NULL,
    published_by uuid,
    published_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: site_assets; Type: TABLE; Schema: public; Owner: -
-- Images the site uses, with a crop per surface and where each came from (upload, product photo, or AI with its prompt
-- and cost), so AI images can be labelled and swapped.
--

CREATE TABLE public.site_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    url text NOT NULL,
    s3_key text,
    width integer,
    height integer,
    mime character varying(60),
    alt text,
    focal jsonb,
    crops jsonb DEFAULT '{}'::jsonb NOT NULL,
    source character varying(10) DEFAULT 'upload'::character varying NOT NULL,
    ai jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: site_templates; Type: TABLE; Schema: public; Owner: -
-- Templates an owner saved ("save as my template"): one page or a whole site pack. Built-in templates ship as JSON in
-- packages/site-blocks/templates.
--

CREATE TABLE public.site_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    description text,
    kind character varying(10) DEFAULT 'page'::character varying NOT NULL,
    archetype character varying(30),
    pages jsonb DEFAULT '[]'::jsonb NOT NULL,
    theme jsonb,
    thumbnail text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
