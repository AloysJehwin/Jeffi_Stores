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


