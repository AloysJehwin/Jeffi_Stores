-- admin-service: platform-only constraints (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.

ALTER TABLE ONLY public.ai_prompt_presets
    ADD CONSTRAINT ai_prompt_presets_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.ai_prompt_presets
    ADD CONSTRAINT ai_prompt_presets_kind_check CHECK (kind IN ('image','video')) NOT VALID;
