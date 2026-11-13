-- admin-service: platform-only tables (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

--
-- Name: ai_cache; Type: TABLE; Schema: public; Owner: -
--
-- Semantic LLM response cache for the ai-platform gateway. A cacheable prompt is embedded
-- (nomic-embed-text, 768-dim) and matched by cosine distance; a close-enough hit returns the
-- stored response instead of calling the model. Written and read only by the gateway.

CREATE TABLE public.ai_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    namespace character varying(64) DEFAULT 'platform'::character varying NOT NULL,
    model_hint character varying(32) NOT NULL,
    context_hash character varying(64) DEFAULT ''::character varying NOT NULL,
    prompt text NOT NULL,
    embedding public.vector(768),
    response text NOT NULL,
    hits integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ai_cache_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_ai_cache_partition ON public.ai_cache USING btree (namespace, model_hint, context_hash);
CREATE INDEX idx_ai_cache_embedding ON public.ai_cache USING hnsw (embedding public.vector_cosine_ops);
