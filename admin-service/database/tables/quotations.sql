-- admin-service: tables. Load order comes from scripts/db-files.mjs.

--
-- Name: rfq_reply_drafts; Type: TABLE; Schema: public; Owner: -
--
-- An admin's unsent reply on an RFQ thread (text and counter prices), one per admin per RFQ.
--

CREATE TABLE public.rfq_reply_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rfq_id uuid NOT NULL,
    admin_id uuid NOT NULL,
    message text DEFAULT ''::text NOT NULL,
    counter_prices jsonb DEFAULT '{}'::jsonb NOT NULL,
    show_counter boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
