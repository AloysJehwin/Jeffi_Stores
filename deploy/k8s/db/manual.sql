-- Release statements schema-diff.sh never applies (it adds no FKs and never alters a column).
-- Run on jeffi_stores as app_user by 10-platform-schema.sh; idempotent.

-- Phone-channel campaign logs carry no email.
ALTER TABLE public.email_campaign_logs ALTER COLUMN email DROP NOT NULL;

-- Foreign keys added since 5c4ffbf4 (NOT VALID first so existing rows don't block the add, then validated).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bulk_job_items_job_fkey' AND conrelid = 'public.bulk_job_items'::regclass) THEN
    ALTER TABLE ONLY public.bulk_job_items ADD CONSTRAINT bulk_job_items_job_fkey FOREIGN KEY (job_id) REFERENCES public.bulk_jobs(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.bulk_job_items VALIDATE CONSTRAINT bulk_job_items_job_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_drafts_kind_fkey' AND conrelid = 'public.campaign_drafts'::regclass) THEN
    ALTER TABLE ONLY public.campaign_drafts ADD CONSTRAINT campaign_drafts_kind_fkey FOREIGN KEY (kind) REFERENCES public.campaigns(kind) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.campaign_drafts VALIDATE CONSTRAINT campaign_drafts_kind_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'offer_drafts_offer_id_fkey' AND conrelid = 'public.offer_drafts'::regclass) THEN
    ALTER TABLE ONLY public.offer_drafts ADD CONSTRAINT offer_drafts_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES public.product_offers(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.offer_drafts VALIDATE CONSTRAINT offer_drafts_offer_id_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_adjustment_lines_adjustment_id_fkey' AND conrelid = 'public.order_adjustment_lines'::regclass) THEN
    ALTER TABLE ONLY public.order_adjustment_lines ADD CONSTRAINT order_adjustment_lines_adjustment_id_fkey FOREIGN KEY (adjustment_id) REFERENCES public.order_adjustments(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.order_adjustment_lines VALIDATE CONSTRAINT order_adjustment_lines_adjustment_id_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_adjustments_order_id_fkey' AND conrelid = 'public.order_adjustments'::regclass) THEN
    ALTER TABLE ONLY public.order_adjustments ADD CONSTRAINT order_adjustments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.order_adjustments VALIDATE CONSTRAINT order_adjustments_order_id_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_adjustments_requested_by_admin_id_fkey' AND conrelid = 'public.order_adjustments'::regclass) THEN
    ALTER TABLE ONLY public.order_adjustments ADD CONSTRAINT order_adjustments_requested_by_admin_id_fkey FOREIGN KEY (requested_by_admin_id) REFERENCES public.admins(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
ALTER TABLE public.order_adjustments VALIDATE CONSTRAINT order_adjustments_requested_by_admin_id_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_template_family_fkey' AND conrelid = 'public.platform_template'::regclass) THEN
    ALTER TABLE ONLY public.platform_template ADD CONSTRAINT platform_template_family_fkey FOREIGN KEY (family_id) REFERENCES public.platform_template_family(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.platform_template VALIDATE CONSTRAINT platform_template_family_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_template_variant_template_fkey' AND conrelid = 'public.platform_template_variant'::regclass) THEN
    ALTER TABLE ONLY public.platform_template_variant ADD CONSTRAINT platform_template_variant_template_fkey FOREIGN KEY (template_id) REFERENCES public.platform_template(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.platform_template_variant VALIDATE CONSTRAINT platform_template_variant_template_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_template_version_variant_fkey' AND conrelid = 'public.platform_template_version'::regclass) THEN
    ALTER TABLE ONLY public.platform_template_version ADD CONSTRAINT platform_template_version_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.platform_template_variant(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.platform_template_version VALIDATE CONSTRAINT platform_template_version_variant_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pub_template_asset_variant_fkey' AND conrelid = 'public.pub_template_asset'::regclass) THEN
    ALTER TABLE ONLY public.pub_template_asset ADD CONSTRAINT pub_template_asset_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.pub_template_variant(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
ALTER TABLE public.pub_template_asset VALIDATE CONSTRAINT pub_template_asset_variant_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pub_template_family_fkey' AND conrelid = 'public.pub_template'::regclass) THEN
    ALTER TABLE ONLY public.pub_template ADD CONSTRAINT pub_template_family_fkey FOREIGN KEY (family_id) REFERENCES public.pub_template_family(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.pub_template VALIDATE CONSTRAINT pub_template_family_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pub_template_variant_template_fkey' AND conrelid = 'public.pub_template_variant'::regclass) THEN
    ALTER TABLE ONLY public.pub_template_variant ADD CONSTRAINT pub_template_variant_template_fkey FOREIGN KEY (template_id) REFERENCES public.pub_template(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.pub_template_variant VALIDATE CONSTRAINT pub_template_variant_template_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pub_template_version_variant_fkey' AND conrelid = 'public.pub_template_version'::regclass) THEN
    ALTER TABLE ONLY public.pub_template_version ADD CONSTRAINT pub_template_version_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.pub_template_variant(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.pub_template_version VALIDATE CONSTRAINT pub_template_version_variant_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sms_dlt_template_variant_fkey' AND conrelid = 'public.sms_dlt_template'::regclass) THEN
    ALTER TABLE ONLY public.sms_dlt_template ADD CONSTRAINT sms_dlt_template_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.template_variant(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.sms_dlt_template VALIDATE CONSTRAINT sms_dlt_template_variant_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_asset_variant_fkey' AND conrelid = 'public.template_asset'::regclass) THEN
    ALTER TABLE ONLY public.template_asset ADD CONSTRAINT template_asset_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.template_variant(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
ALTER TABLE public.template_asset VALIDATE CONSTRAINT template_asset_variant_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_family_fkey' AND conrelid = 'public.template'::regclass) THEN
    ALTER TABLE ONLY public.template ADD CONSTRAINT template_family_fkey FOREIGN KEY (family_id) REFERENCES public.template_family(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.template VALIDATE CONSTRAINT template_family_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_variant_template_fkey' AND conrelid = 'public.template_variant'::regclass) THEN
    ALTER TABLE ONLY public.template_variant ADD CONSTRAINT template_variant_template_fkey FOREIGN KEY (template_id) REFERENCES public.template(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.template_variant VALIDATE CONSTRAINT template_variant_template_fkey;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'template_version_variant_fkey' AND conrelid = 'public.template_version'::regclass) THEN
    ALTER TABLE ONLY public.template_version ADD CONSTRAINT template_version_variant_fkey FOREIGN KEY (variant_id) REFERENCES public.template_variant(id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE public.template_version VALIDATE CONSTRAINT template_version_variant_fkey;
