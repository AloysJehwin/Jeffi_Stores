-- controller-service: foreign-keys. Load order comes from scripts/db-files.mjs.

--
-- Name: admin_agent_actions admin_agent_actions_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_actions
    ADD CONSTRAINT admin_agent_actions_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.admins(id) ON DELETE CASCADE;



--
-- Name: admin_agent_actions admin_agent_actions_decided_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_actions
    ADD CONSTRAINT admin_agent_actions_decided_by_admin_id_fkey FOREIGN KEY (decided_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL;



--
-- Name: admin_agent_actions admin_agent_actions_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_agent_actions
    ADD CONSTRAINT admin_agent_actions_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.admin_agent_messages(id) ON DELETE SET NULL;
