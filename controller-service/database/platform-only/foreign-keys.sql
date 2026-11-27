-- controller-service: platform-only foreign keys (flagship DB only). Loaded last.

ALTER TABLE ONLY public.outreach_contacts ADD CONSTRAINT outreach_contacts_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.outreach_lists(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.outreach_calls ADD CONSTRAINT outreach_calls_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.outreach_contacts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_messages ADD CONSTRAINT outreach_messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.outreach_contacts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_events ADD CONSTRAINT outreach_events_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.outreach_contacts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_skill_versions ADD CONSTRAINT outreach_skill_versions_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.outreach_skills(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_lists ADD CONSTRAINT outreach_lists_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.outreach_skills(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.outreach_lists ADD CONSTRAINT outreach_lists_skill_version_id_fkey FOREIGN KEY (skill_version_id) REFERENCES public.outreach_skill_versions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.outreach_program_state ADD CONSTRAINT outreach_program_state_default_skill_id_fkey FOREIGN KEY (default_skill_id) REFERENCES public.outreach_skills(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.outreach_agent_runs ADD CONSTRAINT outreach_agent_runs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.outreach_contacts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_agent_runs ADD CONSTRAINT outreach_agent_runs_skill_version_id_fkey FOREIGN KEY (skill_version_id) REFERENCES public.outreach_skill_versions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.outreach_agent_tasks ADD CONSTRAINT outreach_agent_tasks_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.outreach_agent_runs(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_agent_tasks ADD CONSTRAINT outreach_agent_tasks_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.outreach_contacts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_jobs ADD CONSTRAINT outreach_jobs_skill_id_fkey FOREIGN KEY (skill_id) REFERENCES public.outreach_skills(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_jobs ADD CONSTRAINT outreach_jobs_skill_version_id_fkey FOREIGN KEY (skill_version_id) REFERENCES public.outreach_skill_versions(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.outreach_jobs ADD CONSTRAINT outreach_jobs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.outreach_contacts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_agent_runs ADD CONSTRAINT outreach_agent_runs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.outreach_jobs(id) ON DELETE SET NULL;
