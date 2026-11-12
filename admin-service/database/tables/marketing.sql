-- admin-service: tables. Load order comes from scripts/db-files.mjs.

-- Generated from live RDS jeffi_stores on 2026-06-30
-- Schema-only dump, no owner, no acl


--
-- Name: campaign_send_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_send_counts (
    campaign_kind character varying(64) NOT NULL,
    user_id uuid NOT NULL,
    send_count integer DEFAULT 0 NOT NULL,
    last_sent_at timestamp with time zone
);


--
-- Name: campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaigns (
    kind character varying(64) NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    enabled boolean DEFAULT true NOT NULL,
    delay_hours integer DEFAULT 24 NOT NULL,
    discount_percent integer DEFAULT 0 NOT NULL,
    subject_template text NOT NULL,
    body_template text NOT NULL,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    scenario_kind character varying(64),
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    coupon_id uuid,
    draft_fields jsonb,
    template_layout character varying(32) DEFAULT 'classic' NOT NULL,
    template_mode character varying(16) DEFAULT 'richtext' NOT NULL,
    blocks jsonb,
    sms_template text,
    wa_template_sid character varying(64),
    wa_variables jsonb,
    wa_header_image_url text,
    email_template_slug character varying(80),
    sms_template_slug character varying(80),
    wa_template_slug character varying(80)
);


--
-- Name: coupon_eligible_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_eligible_users (
    coupon_id uuid NOT NULL,
    user_id uuid NOT NULL,
    added_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    is_draft boolean DEFAULT false NOT NULL,
    code character varying(50) NOT NULL,
    description text,
    discount_type character varying(20) NOT NULL,
    discount_value numeric(12,2) NOT NULL,
    min_purchase_amount numeric(12,2) DEFAULT 0,
    max_discount_amount numeric(12,2),
    usage_limit integer,
    usage_limit_per_user integer DEFAULT 1,
    times_used integer DEFAULT 0,
    valid_from timestamp with time zone,
    valid_until timestamp with time zone,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    auto_generated boolean DEFAULT false NOT NULL,
    generated_for_user_id uuid,
    generated_for_campaign character varying(64)
);


--
-- Name: coupon_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    author_admin_id uuid,
    title character varying(120),
    base jsonb,
    base_revision integer DEFAULT 0 NOT NULL,
    coupon_id uuid NOT NULL,
    fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coupon_drafts_pkey PRIMARY KEY (id)
);


--
-- Name: campaign_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_drafts (
    campaign_id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind character varying(64) NOT NULL,
    fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: email_campaign_logs; Type: TABLE; Schema: public; Owner: -
-- One row per recipient and channel; a push row is one app install (push_device_id; user_id is NULL when
-- signed out). status: sent | failed | skipped, or deferred (quiet hours) until send_after.
--

CREATE TABLE public.email_campaign_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    email character varying(255),
    status character varying(20) DEFAULT 'sent'::character varying NOT NULL,
    error text,
    sent_at timestamp with time zone DEFAULT now(),
    channel character varying(16) DEFAULT 'email'::character varying NOT NULL,
    to_address character varying(255),
    push_device_id uuid,
    user_id uuid,
    send_after timestamp with time zone
);


--
-- Name: email_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title character varying(255) NOT NULL,
    template_key character varying(50) NOT NULL,
    subject character varying(255) NOT NULL,
    template_data jsonb DEFAULT '{}'::jsonb NOT NULL,
    audience_type character varying(50) DEFAULT 'all'::character varying NOT NULL,
    audience_filter jsonb DEFAULT '{}'::jsonb NOT NULL,
    recipient_count integer,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    sent_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    wizard_step smallint DEFAULT 1 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    channels jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: email_campaigns_sent; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaigns_sent (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_kind character varying(64) NOT NULL,
    user_id uuid NOT NULL,
    reference_id character varying(128),
    message_id character varying(255),
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    opened_at timestamp with time zone,
    clicked_at timestamp with time zone,
    converted_at timestamp with time zone,
    conversion_order_id uuid,
    unsubscribed_at timestamp with time zone,
    bounced_at timestamp with time zone,
    complained_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb,
    channel character varying(16) DEFAULT 'email'::character varying NOT NULL
);


--
-- Name: custom_scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_scenarios (
    kind character varying(64) NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    ai_prompt text NOT NULL,
    generated_sql text NOT NULL,
    dry_run_count integer,
    dry_run_at timestamp with time zone,
    approved_by uuid,
    approved_at timestamp with time zone,
    enabled boolean DEFAULT false NOT NULL,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    product_sql text
);


--
-- Name: scenario_drafts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scenario_drafts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    title character varying(128),
    fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: template_variables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_variables (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    key character varying(64) NOT NULL,
    label character varying(120) NOT NULL,
    description text,
    value text DEFAULT ''::text NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scenarios (
    kind character varying(64) NOT NULL,
    name character varying(128) NOT NULL,
    description text,
    default_parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: scenario_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scenario_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scenario_kind character varying(64),
    admin_id uuid,
    action character varying(32) NOT NULL,
    ai_prompt text,
    ai_response text,
    generated_sql text,
    validation jsonb,
    result jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: offer_display_settings; Type: TABLE; Schema: public; Owner: -
--
-- Razorpay offers cannot be created through the API (POST /v1/offers is 405 on this
-- account) — they are configured in the Razorpay dashboard. This table is the storefront
-- side only: which of the account's real offers to show, under what wording, in what order.
-- No row for an offer means "use the default", so an offer appearing in Razorpay shows up
-- without needing a row here.

CREATE TABLE public.offer_display_settings (
    offer_id character varying(64) NOT NULL,
    is_visible boolean DEFAULT true NOT NULL,
    title_override text,
    display_order integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid
);


--
-- Name: loyalty_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_accounts (
    user_id uuid NOT NULL,
    points integer DEFAULT 0 NOT NULL,
    lifetime_points integer DEFAULT 0 NOT NULL,
    tier character varying(20) DEFAULT 'bronze'::character varying NOT NULL,
    tier_updated_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: loyalty_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.loyalty_ledger (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    delta integer NOT NULL,
    reason character varying(40) NOT NULL,
    order_id uuid,
    coupon_id uuid,
    base_amount numeric(12,2),
    note text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: referrals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referrals (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    referrer_user_id uuid NOT NULL,
    referred_email character varying(255),
    referred_user_id uuid,
    referral_code character varying(32) NOT NULL,
    status character varying(20) DEFAULT 'invited'::character varying NOT NULL,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    converted_at timestamp with time zone
);


--
-- Name: referral_signups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.referral_signups (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    referral_id uuid NOT NULL,
    referrer_user_id uuid NOT NULL,
    referred_user_id uuid NOT NULL,
    status character varying(20) DEFAULT 'joined'::character varying NOT NULL,
    reject_reason character varying(40),
    qualifying_order_id uuid,
    points integer,
    signed_up_at timestamp with time zone DEFAULT now() NOT NULL,
    rewarded_at timestamp with time zone
);
