#!/bin/bash
# The LOCAL published homepage as the bundle 60-live-content.sh mirrors onto live: both surfaces' sections, hero
# slides, every offer with its products, the gallery rows the content shows, and the slug of each product and
# category it references (live IDs can differ; the apply remaps by slug).
# Usage: bash deploy/k8s/db/content/export-homepage.sh [database-url]   (default: the local flagship DB)
set -euo pipefail
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
DB=${1:-postgresql://localhost:5432/jeffi_production_ready}
case $DB in *localhost*|*127.0.0.1*) ;; *) echo "Export reads the local DB only." >&2; exit 1 ;; esac
OUT=$REPO/controller-service/src/lib/content/flagship-homepage.json
PGOPTIONS="-c default_transaction_read_only=on" psql "$DB" -v ON_ERROR_STOP=1 -AtX -c "
WITH s AS (
  SELECT id, type, title, subtitle, eyebrow, cta_label, cta_url, config, display_order, is_active, starts_at, ends_at, surface
  FROM homepage_sections ORDER BY surface, display_order, created_at
), h AS (
  SELECT id, title, subtitle, badge_text, badge_color, image_url, image_url_mobile, blurhash, blurhash_mobile, video_url,
         cta_label, cta_url, filter_category, filter_brand, filter_grade, filter_material, filter_min_price,
         filter_max_price, filter_in_stock, filter_on_sale, display_order, is_active, surface
  FROM hero_slides ORDER BY surface, display_order, created_at
), o AS (
  SELECT p.id, p.slug, p.title, p.subtitle, p.badge_text, p.badge_color, p.image_url, p.image_url_mobile, p.blurhash,
         p.blurhash_mobile, p.image_url_card, p.blurhash_card, p.video_url, p.video_url_card, p.cta_label, p.starts_at,
         p.ends_at, p.display_order, p.is_active,
         COALESCE((SELECT jsonb_agg(i.product_id ORDER BY i.created_at, i.product_id) FROM product_offer_items i WHERE i.offer_id = p.id), '[]') AS items
  FROM product_offers p ORDER BY p.display_order, p.created_at
), txt AS (
  SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]') FROM s)::text || (SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]') FROM h)::text
         || (SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]') FROM o)::text AS t
), ids AS (
  SELECT DISTINCT m[1]::uuid AS id FROM txt, regexp_matches(txt.t, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m
)
SELECT jsonb_pretty(jsonb_build_object(
  'exportedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),
  'sections', (SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]') FROM s),
  'heroSlides', (SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]') FROM h),
  'offers', (SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]') FROM o),
  'gallery', (SELECT COALESCE(jsonb_agg(to_jsonb(g) ORDER BY g.created_at), '[]') FROM (
      SELECT id, image_url, thumbnail_url, s3_key, s3_thumbnail_key, s3_bucket, file_name, file_size, mime_type, width,
             height, source_url, created_at, custom_name, blurhash, media_kind, source, prompt_text, model_name
      FROM gallery_images gi WHERE gi.tenant_id IS NULL
        AND (strpos((SELECT t FROM txt), gi.image_url) > 0 OR strpos((SELECT t FROM txt), COALESCE(gi.thumbnail_url, chr(1))) > 0)) g),
  'refs', jsonb_build_object(
    'products', (SELECT COALESCE(jsonb_object_agg(p.id, p.slug), '{}') FROM products p JOIN ids USING (id)),
    'categories', (SELECT COALESCE(jsonb_object_agg(c.id, c.slug), '{}') FROM categories c JOIN ids USING (id)))
))" > "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
python3 -I -c 'import json,sys; b=json.load(open(sys.argv[1])); print("sections", len(b["sections"]), "· hero slides", len(b["heroSlides"]), "· offers", len(b["offers"]), "· gallery", len(b["gallery"]), "· products", len(b["refs"]["products"]), "· categories", len(b["refs"]["categories"]))' "$OUT"
echo "Wrote $OUT"
