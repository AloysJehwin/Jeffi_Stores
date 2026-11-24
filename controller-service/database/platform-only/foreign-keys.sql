-- controller-service: platform-only foreign keys (flagship DB only). Loaded last.

ALTER TABLE ONLY public.outreach_contacts ADD CONSTRAINT outreach_contacts_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.outreach_lists(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.outreach_calls ADD CONSTRAINT outreach_calls_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.outreach_contacts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_messages ADD CONSTRAINT outreach_messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.outreach_contacts(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.outreach_events ADD CONSTRAINT outreach_events_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.outreach_contacts(id) ON DELETE CASCADE;
