-- storefront-service: tables. Load order comes from scripts/db-files.mjs.

--
-- Name: coupon_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupon_usage (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    coupon_id uuid,
    user_id uuid,
    order_id uuid,
    discount_amount numeric(12,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: reward_game_plays; Type: TABLE; Schema: public; Owner: -
-- One row per play of a homepage rewards game (game_key is the section's own key, not its row id:
-- publish recreates section rows, and the key survives a copy onto the other surface). period_key is
-- the play window the limit applies to ('once', a date, or an ISO week), unique per user and game.
--

CREATE TABLE public.reward_game_plays (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    game_key uuid NOT NULL,
    user_id uuid NOT NULL,
    period_key character varying(16) NOT NULL,
    prize_id character varying(64) NOT NULL,
    prize_label character varying(120) NOT NULL,
    coupon_id uuid,
    played_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    product_id uuid NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    interval_minutes integer NOT NULL,
    next_renewal_at timestamp with time zone NOT NULL,
    last_renewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Razorpay-backed customer subscriptions (razorpay_subscription_id IS NULL => legacy crons-era stub,
    -- which is all the subscription_renewal campaign is now allowed to read).
    razorpay_subscription_id character varying(64),
    razorpay_plan_id character varying(64),
    variant_id uuid,
    sub_variant_id uuid,
    quantity numeric(10,3) DEFAULT 1 NOT NULL,
    interval character varying(12),
    interval_count integer DEFAULT 1 NOT NULL,
    period character varying(10),
    unit_price_paise bigint,
    unit_price_ex_gst numeric(12,2),
    shipping_paise bigint DEFAULT 0 NOT NULL,
    gst_rate numeric(5,2),
    hsn_code character varying(20),
    is_digital boolean DEFAULT false NOT NULL,
    address_id uuid,
    address_snapshot jsonb,
    collecting_account character varying(12) DEFAULT 'platform'::character varying NOT NULL,
    linked_account_id character varying(32),
    current_cycle integer DEFAULT 0 NOT NULL,
    current_start timestamp with time zone,
    current_end timestamp with time zone,
    access_expires_at timestamp with time zone,
    total_count integer,
    min_cycles integer,
    term_cycles integer,
    consent_version character varying(16),
    consent_at timestamp with time zone,
    cancel_at_cycle_end boolean DEFAULT false NOT NULL,
    cancel_requested_at timestamp with time zone,
    paused_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    locked_price_at timestamp with time zone,
    source character varying(12) DEFAULT 'legacy'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Which gateway bills the renewals. 'phonepe' = PhonePe Autopay (UPI mandate; we notify + execute each cycle).
    billing_provider character varying(12) DEFAULT 'razorpay'::character varying NOT NULL,
    phonepe_merchant_subscription_id character varying(63),
    phonepe_subscription_id character varying(64),
    phonepe_setup_order_id character varying(63),
    phonepe_mandate_state character varying(24),
    phonepe_mandate_expires_at timestamp with time zone
);
