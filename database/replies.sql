--
-- Name: reply_contexts; Type: TABLE; Schema: public; Owner: -
-- A question the store put to a customer (an adjustment, a quotation, a payment...). The customer's
-- WhatsApp or email reply is matched back to it; token is the Reply-To address part.
--

CREATE TABLE public.reply_contexts (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    token character varying(32) NOT NULL,
    user_id uuid,
    contact_email character varying(255),
    contact_phone character varying(20),
    scenario character varying(32) NOT NULL,
    entity_type character varying(32) NOT NULL,
    entity_id uuid NOT NULL,
    ref_id uuid,
    status character varying(12) DEFAULT 'open'::character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_sent_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reply_context_sends; Type: TABLE; Schema: public; Owner: -
-- Each message that carried the question, so a WhatsApp "reply to" or an email In-Reply-To finds it.
--

CREATE TABLE public.reply_context_sends (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    context_id uuid NOT NULL,
    channel character varying(12) NOT NULL,
    provider_sid character varying(128),
    email_message_id character varying(255),
    sent_at timestamp with time zone DEFAULT now() NOT NULL
);
