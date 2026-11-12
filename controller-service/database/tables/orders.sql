-- controller-service: tables. Load order comes from scripts/db-files.mjs.

--
-- Name: delhivery_pickup_locations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.delhivery_pickup_locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid,
    name character varying(255) NOT NULL,
    pin character varying(16) DEFAULT ''::character varying NOT NULL,
    phone character varying(32) DEFAULT ''::character varying NOT NULL,
    address text DEFAULT ''::text NOT NULL,
    city character varying(128) DEFAULT ''::character varying NOT NULL,
    state character varying(128) DEFAULT ''::character varying NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
