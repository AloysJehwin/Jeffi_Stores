-- Copy product_images / variant_images into product_media (same id, so a re-run changes nothing),
-- and attach the audit triggers the schema diff does not create.

INSERT INTO public.product_media
  (id, root_product_id, product_id, kind, url, s3_key, thumbnail_url, s3_thumbnail_key, file_name, mime,
   size_bytes, width, height, alt, sort_order, is_primary, metadata, created_at, updated_at)
SELECT i.id, i.product_id, i.product_id, 'image', i.image_url, i.s3_key, i.thumbnail_url, i.s3_thumbnail_key,
       i.file_name, i.mime_type, i.file_size, i.width, i.height, i.alt_text, COALESCE(i.display_order, 0),
       COALESCE(i.is_primary, false),
       CASE WHEN i.blurhash IS NOT NULL THEN jsonb_build_object('blurhash', i.blurhash) ELSE '{}'::jsonb END,
       COALESCE(i.created_at, now()), COALESCE(i.updated_at, now())
  FROM public.product_images i
 WHERE i.product_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.product_media
  (id, root_product_id, variant_id, kind, url, s3_key, thumbnail_url, s3_thumbnail_key, file_name, mime,
   size_bytes, width, height, alt, sort_order, is_primary, metadata, created_at, updated_at)
SELECT vi.id, v.product_id, vi.variant_id, 'image', vi.image_url, vi.s3_key, vi.thumbnail_url, vi.s3_thumbnail_key,
       vi.file_name, vi.mime_type, vi.file_size, vi.width, vi.height, vi.alt_text, COALESCE(vi.display_order, 0),
       COALESCE(vi.is_primary, false),
       CASE WHEN vi.blurhash IS NOT NULL THEN jsonb_build_object('blurhash', vi.blurhash) ELSE '{}'::jsonb END,
       COALESCE(vi.created_at, now()), COALESCE(vi.updated_at, now())
  FROM public.variant_images vi
  JOIN public.product_variants v ON v.id = vi.variant_id
ON CONFLICT (id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_audit_product_media ON public.product_media;
CREATE TRIGGER trg_audit_product_media AFTER INSERT OR DELETE OR UPDATE ON public.product_media FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('kind,url,thumbnail_url,alt,caption,is_primary,status', 'root_product_id');
DROP TRIGGER IF EXISTS trg_audit_product_faqs ON public.product_faqs;
CREATE TRIGGER trg_audit_product_faqs AFTER INSERT OR DELETE OR UPDATE ON public.product_faqs FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('question,answer,published', 'product_id');
