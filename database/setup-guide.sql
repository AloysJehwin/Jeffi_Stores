--
-- Setup guide (lib/setup-guide): the store's manual progress on steps the app cannot see for itself
-- (applied for an approval on a date, approved, skipped). Detected state comes from the real data.
--

CREATE TABLE public.setup_guide_progress (
    step_id character varying(64) NOT NULL,
    state character varying(16) NOT NULL,
    applied_at date,
    note text,
    updated_by character varying(255),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
