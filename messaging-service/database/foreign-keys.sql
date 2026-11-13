-- messaging-service: foreign-keys. Load order comes from scripts/db-files.mjs.

ALTER TABLE ONLY public.template ADD CONSTRAINT template_family_fkey FOREIGN KEY (family_id) REFERENCES public.template_family(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.template_variant ADD CONSTRAINT template_variant_template_fkey FOREIGN KEY (template_id) REFERENCES public.template(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.template_version ADD CONSTRAINT template_version_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.template_variant(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.template_asset ADD CONSTRAINT template_asset_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.template_variant(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.sms_dlt_template ADD CONSTRAINT sms_dlt_template_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.template_variant(id) ON DELETE CASCADE;
