-- showcase-service: platform-only foreign keys (flagship DB only, never a store tenant's). Load order comes from scripts/db-files.mjs.
-- None to tenants or owners: the control-plane set loads after the platform set.

ALTER TABLE ONLY public.showcase_leads ADD CONSTRAINT showcase_leads_site_fkey FOREIGN KEY (site_id) REFERENCES public.showcase_sites(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.showcase_sessions ADD CONSTRAINT showcase_sessions_site_fkey FOREIGN KEY (site_id) REFERENCES public.showcase_sites(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.showcase_events ADD CONSTRAINT showcase_events_session_fkey FOREIGN KEY (site_id, session_id) REFERENCES public.showcase_sessions(site_id, session_id) ON DELETE CASCADE;
ALTER TABLE ONLY public.showcase_preview_tokens ADD CONSTRAINT showcase_preview_tokens_site_fkey FOREIGN KEY (site_id) REFERENCES public.showcase_sites(id) ON DELETE CASCADE;
