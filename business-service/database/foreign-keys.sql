-- business-service: foreign-keys. Load order comes from scripts/db-files.mjs.

--
-- Name: business_rfq_items business_rfq_items_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfq_items
    ADD CONSTRAINT business_rfq_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id);



--
-- Name: business_rfq_items business_rfq_items_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfq_items
    ADD CONSTRAINT business_rfq_items_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.business_rfqs(id) ON DELETE CASCADE;



--
-- Name: business_rfq_items business_rfq_items_sub_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfq_items
    ADD CONSTRAINT business_rfq_items_sub_variant_id_fkey FOREIGN KEY (sub_variant_id) REFERENCES public.product_sub_variants(id) ON DELETE SET NULL;



--
-- Name: business_rfq_items business_rfq_items_variant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfq_items
    ADD CONSTRAINT business_rfq_items_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES public.product_variants(id) ON DELETE SET NULL;



--
-- Name: business_rfqs business_rfqs_converted_quotation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfqs
    ADD CONSTRAINT business_rfqs_converted_quotation_id_fkey FOREIGN KEY (converted_quotation_id) REFERENCES public.quotations(id);



--
-- Name: business_rfqs business_rfqs_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfqs
    ADD CONSTRAINT business_rfqs_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.admins(id);



--
-- Name: business_rfqs business_rfqs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.business_rfqs
    ADD CONSTRAINT business_rfqs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);



--
-- Name: rfq_messages rfq_messages_rfq_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rfq_messages
    ADD CONSTRAINT rfq_messages_rfq_id_fkey FOREIGN KEY (rfq_id) REFERENCES public.business_rfqs(id) ON DELETE CASCADE;
