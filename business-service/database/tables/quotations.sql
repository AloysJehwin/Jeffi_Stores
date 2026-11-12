-- business-service: tables. Load order comes from scripts/db-files.mjs.

-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: business_rfq_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_rfq_items (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    rfq_id uuid NOT NULL,
    product_id uuid,
    variant_id uuid,
    description text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit text DEFAULT 'Nos'::text NOT NULL,
    notes text,
    "position" integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    requested_price numeric(12,2),
    sub_variant_id uuid,
    CONSTRAINT business_rfq_items_quantity_check CHECK ((quantity > 0))
);


--
-- Name: business_rfqs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.business_rfqs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    rfq_number text NOT NULL,
    user_id uuid NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    notes text,
    converted_quotation_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    admin_note text,
    reviewed_by uuid,
    reviewed_at timestamp with time zone
);


--
-- Name: rfq_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rfq_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rfq_id uuid NOT NULL,
    sender text NOT NULL,
    message text NOT NULL,
    counter_items jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rfq_messages_sender_check CHECK ((sender = ANY (ARRAY['admin'::text, 'customer'::text])))
);
