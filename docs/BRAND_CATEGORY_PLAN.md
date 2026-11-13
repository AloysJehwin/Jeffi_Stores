# Brand & category plan

Status: **proposal, nothing built** (2026-11-13). Planning only: no schema, code or migration has been written for it.

Goal: turn `brands` and `categories` from name-and-slug lookups into reference data that products inherit from and that
every surface reads: storefront filters, the product form, search, SEO, feeds, invoices, the mobile app and the public
API. That is how Amazon and Flipkart use them: the category decides which attributes a product must have, which
filters a shopper sees, how it is taxed and which rules apply; the brand carries identity, trust, origin and service.

Where it lives when built (per `CLAUDE.md`): both tables are owned by **admin-service**
(`admin-service/database/tables/catalog.sql`). New columns and tables go there, with keys and checks in
`constraints.sql`, FKs in `foreign-keys.sql`, indexes in `indexes.sql`, triggers in `triggers.sql`. No migration for
new tables, columns or indexes. A migration (`admin-service/database/migrations/YYYY-MM-DD_*.sql`) is needed only for
the data steps flagged below (re-keying `specifications`, backfills). The tenant fan-out applies it all to every store.

---

## 1. Where we are today

Local data (`jeffi_production_ready`, 2026-11-13): 50 brands, 66 categories (10 roots, 56 children, max depth 2),
1,201 products, all on leaf categories. **0 brands have a logo**, 49 have a website. 0 categories have `image_url`,
30 have a Google category. Every product is `country_of_origin = IN`, 1 has a manufacturer name, 0 have a warranty.

### Schema

| Table | Columns today |
| --- | --- |
| `brands` | `id, name, slug, logo_url, description, website, is_active, is_draft, created_at`, return / replacement allowed and window days. No `updated_at`. |
| `categories` | `id, name, slug, description, image_url, parent_category_id, display_order, is_active, is_draft, sku_prefix, google_product_category, icon_name`, return / replacement allowed and window days, `hero_image_mobile`, `hero_image_desktop`, `reorder_interval_days`, `created_at`, `updated_at`. |
| `brand_drafts`, `category_drafts` | Draft copies (`fields` jsonb) used by the multi-draft editor. |
| Referencing | `products.brand_id` (ON DELETE SET NULL), `products.category_id`, `business_discounts.category_id`, `gallery_images.category_id`, `price_inflation_log.category_id` (no reader), `gmc_best_sellers.category_id` (Google's ID, text). |

Everything Amazon or Flipkart would keep on a brand or category (HSN, compliance, manufacturer, warranty, attributes)
is either per product or missing.

### Admin

- **Brand form** (`packages/store-core/src/components/admin/BrandForm.tsx`): name, slug, website, logo URL, description
  (AI enrich), active, return / replacement policy. Ten fields. Writes go through `brands/add/actions.ts`,
  `brands/[id]/edit/actions.ts`, `api/(admin)/admin/brands/[id]/route.ts` (PUT; cascades `is_active` to products) and
  the draft whitelist `CONTENT_COLS` in `packages/store-core/src/lib/catalog/brand-draft.ts`.
- **Category form** (`CategoryForm.tsx`): name, icon (AI suggested), image URL, parent, display order, SKU prefix,
  Google category (a `GoogleTaxonomyPicker` with AI auto-match is in progress, uncommitted), description (AI enrich),
  active, policy override inherited from the parent. The parent picker lists **top-level categories only**, so the
  tree cannot go deeper than two levels. `hero_image_*` is written only by the PUT route and `reorder_interval_days` by
  nothing in the UI. Draft whitelist: `category-draft.ts`.
- **Product form** (`ProductForm.tsx`): category is a two-level select, brand a flat select. The only thing the
  category drives is the server-side SKU prefix (`lib/catalog/sku.ts`). `hsn_code` is free text, `gst_percentage`
  defaults to 18, `specifications` is free key / value rows. Nothing is required per category; variant axes are free
  text (`variant_type`, `sub_variant_type`).
- **Import** (`lib/import/columns.ts`, `controller-service/src/lib/catalog/product-import.ts`): brand and category
  by case-insensitive name; an unknown name fails the row. Export emits names only.
- **Admin agent** (`lib/admin-agent/actions/catalog.ts`): `createBrand`, `createCategory` insert live rows and skip
  the draft flow and policy defaults; no update actions.
- **Provisioning** (`controller-service/src/lib/provisioning/seed.ts`): seeds one starter category per onboarding
  profile, no brands, no tax or Google data.

### Where they are read

| Surface | What it reads | Gaps |
| --- | --- | --- |
| `/products`, `/categories/[slug]` (`lib/catalog/listing-model.ts`, `product-filters.ts`, `FilterSidebar.tsx`) | Category tree by id or slug (recursive), brand by id or slug; facets built live: brand, colour, grade, material, finish, compliance, origin, price, variant values, and `specFacets` from whatever keys `specifications` holds | Spec facets inherit the key chaos (`Finish` and `finish` show as two filters); no facet order, no range facets on spec numbers |
| `/brands`, `/brands/[slug]` | `logo_url, name, description, website` | Brand page has sort only, **no filters**; no banner, story or category tabs |
| `/categories` | `name, slug, icon_name, description`, subcategory chips | `image_url`, `hero_image_*` unused |
| Product page (`products/[slug]/page.tsx`, `ProductDetailClient.tsx`) | Category and parent `{id, name, slug}`, brand `{id, name, slug}`, return fields | Breadcrumb skips the parent; JSON-LD `Brand` has a name only; **no `BreadcrumbList` JSON-LD anywhere** |
| Return policy | Product page: category window first, else brand, else 7. Order time (`lib/catalog/return-policy.ts`): every flag must allow, window = **minimum** of brand, category, parent | **The two disagree**, and both ignore `products.return_window_days`, which the product form edits |
| Search | `products.search_vector` (two triggers in `functions.sql` / `triggers.sql` both rewrite it: name, sku, description), autocomplete (`api/(public)/search`), pgvector embeddings (`lib/shared/embed-products.ts`) | **Brand and category names are not in the vector or the embedding text**; autocomplete suggests categories, never brands |
| SEO (`app-shell/sitemap.ts`) | `categories.slug, updated_at`, `brands.slug, created_at` | **No `generateMetadata`** on `/products`, `/categories`, `/categories/[slug]`, `/brands`, `/brands/[slug]` (no title, description, canonical, OG) |
| Google Merchant (`api/(public)/feed/google/route.ts`, `lib/merchant/mapper.ts`) | Brand name; selects `google_product_category` for category and parent | **Neither the XML feed nor the API sync sends `google_product_category` or `product_type`**; the helpers in `lib/shared/google-merchant-helpers.ts` are called only by tests |
| Amazon (`lib/amazon/mapper.ts`, `sync.ts`) | Brand name as brand and manufacturer; category name as `item_type_name` | Product type comes from a **hard-coded name dictionary** (`CATEGORY_PRODUCT_TYPE`), fallback `HARDWARE_HANDLE`; no category attributes, so the SCREWS push still lacks `thread_size`, `head_style`, `drive_system` |
| Ajio / Myntra export (`lib/marketplace/catalog-export.ts`) | Brand and category names | No channel category IDs or attribute mapping. No Meta catalog feed exists |
| Homepage (`lib/catalog/homepage-model.ts`, `homepage-extras.ts`) | Top-level categories (grid, showcase, tabs), top brands (carousel), `hero_image_*` fallback, hero slides `filter_category` / `filter_brand` | `BrandCarousel` shows initials, ignoring `logo_url`; `CategoryGrid` ignores `image_url`; header and footer link only to `/categories` (no mega-menu) |
| Recommendations (`lib/catalog/recommendations.ts`) | Brand and category ids and names for "for you", diversity caps, LLM prompt | – |
| Reorder reminders (`campaigns/scenarios/replenishment.ts`) | `reorder_interval_days`, parent fallback | No admin field |
| GST and invoices (`gst/gstr1/route.ts`, `document-service/src/lib/invoice-pdf.ts`, `lib/orders/order-commit.ts`) | Product `hsn_code`, `gst_percentage`, snapshotted on the order item; GSTR-1 falls back to `9999` / 18 | **Category is never consulted**; no UQC; 63 Screws store "HSN Code" as a spec instead |
| B2B (`lib/catalog/business-discount.ts`, `business-service/.../products/page.tsx`) | `business_discounts` by exact category; category tree and brand filters | No parent inheritance, no brand discounts |
| Analytics (`lib/queries/dashboard.ts`, `queries/analytics.ts`, inventory overview) | Revenue, counts and stock value grouped by brand or category **name** | Group by name breaks on rename; no margin by category |
| Mobile (`mobile-service/client/src/api/brands.ts`, `categories.ts`, `app/brands/*`, `app/category/*`) | Storefront `/api/brands` (`id, name, slug`) and `/api/categories` | Every new field needs the storefront route and `src/types/index.ts` extended |
| Public API, `packages/api-contracts` | Nothing | No brand or category endpoint or type |

Side notes for cleanup: `storefront-service/src/app/api/(public)/brands/route.ts` has an admin-scoped `POST` that
inserts brands outside the draft flow; `docs/amazon-brand-approval-followup.md` points at
`controller-service/src/lib/amazon/mapper.ts`, which now lives in `packages/store-core/src/lib/amazon/mapper.ts`.

---

## 2. What the big marketplaces keep

Short version of the research; sources at the end.

**Brand.**
- *Amazon Brand Registry* asks for the brand name exactly as on the trademark record, the registration number, the
  logo, the product categories the brand sells in, and a photo of the product or pack showing the brand. Only the
  trademark owner enrols; agents are added as users. Registry unlocks the brand store page, A+ content, brand analytics
  and protection against other sellers creating listings under the brand. Brand gating also works per category: our
  own TVS push is blocked by exactly this (`docs/amazon-brand-approval-followup.md`, error 5461).
- *Flipkart* brand approval asks for a trademark certificate **or** a brand authorization letter on the owner's
  letterhead (resellers add supplier invoices), plus logo and product images with MRP; some categories ask for extra
  licences (FSSAI for food).
- On the shopper side both show: brand store page (banner, story, category tabs), "Visit the X store" link on every
  product, a verified or authorized-seller signal, manufacturer / importer / packer and country of origin, warranty
  terms with service-centre contacts, and the brand's return policy where it differs.

**Category.**
- *Amazon* separates the **product type** (one per product; a JSON Schema per type and marketplace lists required and
  conditionally required attributes, variation themes, units and enums, fetched by the Product Type Definitions API)
  from **browse nodes** (navigation; a product can sit in several). Our Amazon mapper already hit this: the SCREWS
  type needs `thread_size`, `thread_style`, `head_style`, `drive_system`, `number_of_items` before a clean push.
- *Flipkart* works per **vertical**: each has its own attribute template, commission and fee band, return window and
  required documents.
- *Google Merchant Center* needs `brand` on almost every product, `google_product_category` from Google's fixed
  taxonomy (ID or path, not both), and accepts our own hierarchy as `product_type` (up to 750 chars). Some categories
  add required attributes (apparel: color, size, age group, gender in several countries).
- *India compliance* is mostly category-driven:
  - Legal Metrology (Packaged Commodities) Rules: manufacturer / packer / importer name and address, country of origin,
    generic name, net quantity, MRP and consumer care on pre-packaged goods.
  - Consumer Protection (E-Commerce) Rules 2020: every listing shows country of origin, plus importer details for
    imported goods. A September 2026 amendment (reported by one law firm; check the gazette) applies from
    2027-01-01 and adds a searchable, sortable country-of-origin filter from 2027-07-01.
  - BIS: notified electronics and IT goods need a CRS registration number (R-number), others an ISI licence under a
    Quality Control Order; marketplaces check for it before a listing goes live.
  - FSSAI licence for food, licences for drugs and some chemicals, age gates for some goods.
  - GST: HSN on every invoice line, at least 6 digits above ₹5 crore aggregate turnover (4 below, 8 for exports),
    with a unit quantity code (UQC) in the GSTR-1 HSN summary. HSN and rate follow the kind of goods, so a category is
    the natural default.
- *PIM practice* (Akeneo and similar): a **family** (our category) owns an attribute set; each attribute has a type,
  unit, allowed values and validation; a **variant family** names the axes (one or two levels) and which attributes
  sit on the parent and which on each variant. Our product → variant → sub-variant model already has two levels.

---

## 3. Proposed data

Each field lists what it feeds. "Default" means a product inherits it unless the product sets its own value (see
§5, Resolution).

### 3.1 Brand (`brands` + new columns)

Existing: `name, slug, logo_url, description, website, is_active, is_draft, created_at`, return / replacement allowed
and window days.

| Group | Field | Type | Feeds |
| --- | --- | --- | --- |
| Identity | `legal_name` | varchar(255) | Owner company on the brand page, feeds' manufacturer fallback, document matching |
| | `aliases` | text[] | Search synonyms ("Unbrako" / "UNBRAKO"), import matching, autocomplete |
| | `tagline` | varchar(160) | Brand page header, brand cards, carousel captions |
| | `story` | text (markdown) | Brand page "About", AI enrichment context; `description` stays the short blurb |
| | `brand_type` | varchar(20): `manufacturer`, `private_label`, `distributor`, `white_label` | "Our brand" badge, margin reports, Amazon/Flipkart approval route |
| | `updated_at` | timestamptz | Sitemap `lastmod`, cache busting, drafts (it is missing today) |
| Visual | `logo_dark_url`, `logo_square_url` | varchar(500) | Dark theme, app chips and carousels (`logo_url` stays primary) |
| | `banner_desktop_url`, `banner_mobile_url` | text | Brand page hero (same pair categories already have) |
| | `brand_color` | varchar(7) | Brand page accent, chip colour |
| | `is_featured`, `display_order` | bool, int | Homepage brand carousel, A–Z brand index ordering |
| Origin and maker | `country_of_origin` | char(2) | Default for products; listing and invoice COO line; COO filter |
| | `founded_year`, `headquarters` | smallint, varchar(255) | Brand page facts, `Organization` JSON-LD |
| | `manufacturer_name`, `manufacturer_address` | varchar(255), text | Default for the product Legal Metrology block (filled on 1 of 1,201 products today) |
| | `importer_name`, `importer_address`, `packer_name`, `packer_address` | same | Same, for imported or repacked goods |
| | `consumer_care` | text | Product page consumer care, order emails, invoice footer |
| Trust | `verification_status` | varchar(12): `unverified`, `pending`, `verified`, `rejected` | "Verified brand" badge, admin queue, feed gating |
| | `verified_at`, `verified_by` | timestamptz, uuid | Audit |
| | `seller_relationship` | varchar(24): `owner`, `authorized_distributor`, `authorized_reseller`, `unverified_reseller` | "Authorized seller" badge; decides which proof `brand_documents` must hold |
| | `trademark_number`, `trademark_classes` | varchar(40), smallint[] | Brand page, Amazon / Flipkart applications (files live in `brand_documents`) |
| | `authorization_valid_until` | date | Expiry reminder, badge drops after expiry |
| Warranty and service | `default_warranty_months`, `default_warranty_type` | int, varchar(30) | Default for product warranty (set on 0 products today) |
| | `warranty_terms` | text | Product page "Warranty" tab, invoice note |
| | `service_phone`, `service_email`, `service_url` | varchar | Product page "Service and support", order emails, support desk |
| Policy | `return_policy_note` | text | Shown next to the resolved return window when the brand's rule differs |
| | `map_price_floor_pct` | numeric(5,2) | Minimum advertised price guard for discounts and offers |
| | `default_lead_time_days` | int | Default for product lead time; delivery estimate; B2B quotes |
| | `default_supplier_id` | uuid → `suppliers` | Purchase orders and reorder suggestions |
| Links | `social_links` | jsonb `{instagram, youtube, facebook, linkedin, x}` | Brand page, JSON-LD `sameAs` |
| | `catalogue_pdf_url` | text | Brand page and B2B portal download |
| SEO | `meta_title`, `meta_description` | varchar(160), varchar(320) | Brand page `<head>` |
| | `seo_content` | text | Copy under the brand page grid |
| | `seo_noindex` | bool | Thin brand pages stay out of the index and sitemap |
| Channels | `channel_names` | jsonb `{amazon, flipkart, google}` | Exact brand string each channel expects (Amazon wants the trademark spelling) |

New tables:

- **`brand_documents`**: `id, brand_id, kind` (`trademark_certificate`, `trademark_application`,
  `authorization_letter`, `distributor_agreement`, `purchase_invoice`, `bis_licence`, `fssai_licence`, `other`),
  `number, issuer, valid_from, valid_until, storage_key, status, verified_by, verified_at, notes`. Files go to the
  private bucket the way `product_files` does (presigned GETs only, never joined by storefront queries). Feeds:
  verification queue, expiry reminders, marketplace applications.
- **`brand_categories`**: `brand_id, category_id, status` (`approved`, `pending`, `blocked`), `source` (`internal`,
  `amazon`, `flipkart`), `approved_at`. Feeds: brand page category tabs, a product-form warning when the brand is not
  approved for the chosen category, Amazon / Flipkart push pre-checks.
- *(later)* **`brand_service_centres`**: `brand_id, city, pincode, address, phone`. Feeds: a service-centre lookup by
  pincode on the product page.

### 3.2 Category (`categories` + new columns)

Existing: `name, slug, description, image_url, parent_category_id, display_order, is_active, is_draft, sku_prefix,
google_product_category` (a picker with auto-match on save is in progress), `icon_name`, return / replacement allowed
and window, `hero_image_mobile`, `hero_image_desktop`, `reorder_interval_days`.

| Group | Field | Type | Feeds |
| --- | --- | --- | --- |
| Tree | `path_ids` | uuid[] (root → self), kept by trigger | Breadcrumbs, descendant filters without recursive CTEs, inheritance lookups |
| | `depth`, `is_leaf` | smallint, bool (trigger) | Product form only offers leaf categories (Amazon and Flipkart require one) |
| | `full_slug` | varchar(400), e.g. `fasteners/screws` | Nested URLs, canonical, sitemap, feed `product_type` |
| Display | `short_name` | varchar(40) | Mega-menu and app tab labels |
| | `tagline` | varchar(160) | Category header, tiles |
| | `show_in_nav`, `is_featured` | bool | Mega-menu, footer, homepage category grid |
| | `banner_link_url` | text | Click-through on the hero image |
| | `default_sort` | varchar(20) | Listing default (`popular`, `new`, `price_asc`) |
| | `listing_layout` | varchar(10): `grid`, `table` | Tools and fasteners read better as a spec table |
| SEO | `meta_title`, `meta_description` | varchar(160), varchar(320) | Category page `<head>` |
| | `seo_content` | text (markdown) | Buying-guide copy under the grid |
| | `seo_noindex` | bool | Keeps thin or duplicate categories out of the index |
| | `product_title_template` | varchar(255), e.g. `{brand} {name} {thread_size} x {length}` | Auto product titles, feed titles, AI enrichment |
| Tax | `default_hsn_code` | varchar(8) | Product form prefill; invoice fallback; HSN check (Screws, Bolts, Nuts are all `7318` today) |
| | `hsn_prefixes` | text[] | Validation: a product's HSN must start with one of these (Hand Tools spans 17 codes under `8201`–`8211`) |
| | `default_gst_rate` | numeric(5,2) | Product form prefill, price-ex-GST maths, invoice fallback |
| | `default_uqc` | varchar(3) | GSTR-1 HSN summary unit (`NOS`, `PCS`, `KGS`, `MTR`) |
| | `default_tax_class` | varchar(30) | Default for `products.tax_class` |
| Fulfilment | `default_handling_days` | int | Default for `products.handling_days`, delivery promise |
| | `default_shipping_class`, `default_package_type` | varchar(30) | Courier choice, rate cards, Delhivery labels |
| | `cod_allowed` | bool | Default for `products.is_cod_allowed` |
| | `ships_by_air` | bool | Hazmat routing (lubricants, batteries, aerosols) |
| | `non_returnable_reason` | text | Shown when `return_allowed` is off (hygiene, cut-to-length) |
| Compliance | `bis_scheme` | varchar(8): `none`, `crs`, `isi` | Makes the BIS number attribute required; listing blocked without it |
| | `requires_fssai`, `legal_metrology` | bool | Makes the licence or the packaged-commodity block required |
| | `min_buyer_age` | smallint | Age gate at checkout, feed `adult` flag |
| | `requires_licence` | varchar(40) | Licence check at checkout or B2B only (chemicals, explosives, drugs) |
| | `restricted_states` | text[] | Pincode serviceability, checkout block |
| | `msds_required` | bool | Safety data sheet must be attached (chemicals, lubricants) |
| Finance | `target_margin_pct`, `min_margin_pct` | numeric(5,2) | Pricing warnings, `price_inflation_log` rules, offer guard |
| Content | `size_chart_id` | uuid → `size_charts` | Product page chart, also used for thread and dimension tables |

New tables:

- **`category_channel_mappings`**: `category_id, channel` (`google`, `amazon`, `flipkart`, `meta`, `ondc`),
  `external_id, external_path, product_type` (Amazon), `attribute_map` jsonb (our attribute code → channel attribute),
  `fee_pct`, `fixed_fee`, `verified_at`. One row per category and channel, resolved from the nearest ancestor. Feeds:
  GMC `google_product_category`, the Amazon mapper's product type and attribute names, channel price
  (price + fee), ONDC category code. `categories.google_product_category` becomes a shortcut for the Google row.
- **`category_faqs`** (same shape as `product_faqs`). Feeds: category page FAQ block, `FAQPage` JSON-LD, the support bot.
- **`size_charts`**: `id, name, category_id, brand_id, unit_system, columns` jsonb, `rows` jsonb, `notes, image_url`.
  Resolved brand + category, then brand, then category, then ancestor. For this catalogue it holds thread pitch and
  head dimension tables (DIN 912, ISO 4762) as much as clothing sizes.
- *(later)* **`product_browse_categories`**: `product_id, category_id`. Extra navigation homes for a product (Amazon's
  browse nodes). `products.category_id` stays the one item type that decides schema, tax and policy.

### 3.3 Category attribute schema

Today `products.specifications` is free-form jsonb typed in by hand. Across the 275 Screws the same fact sits under
different keys (`Finish` 166 / `finish` 51, `Material` 136 / `material` 49, `Thread Size` 14 / `thread_size` 12,
`Length Variants` / `length_variant`), and about 60 of them store `HSN Code` as a spec. No filter, feed or check can
rely on it. The fix is a schema per category.

**`attribute_definitions`** (one library per store, seeded from a vertical template):

| Field | Type | Purpose |
| --- | --- | --- |
| `code` | varchar(64), unique, snake_case | Stable key used in `specifications`, URLs (`?thread_size=m8`) and channel maps |
| `label`, `help_text` | varchar(100), text | Form label and hint, product page label |
| `data_type` | `text`, `long_text`, `number`, `integer`, `boolean`, `enum`, `multi_enum`, `dimension`, `range`, `color`, `date`, `url` | Form widget, validation, facet type |
| `unit_family`, `default_unit`, `allowed_units` | varchar, varchar, text[] | `length` in mm or inch, `torque` in Nm; values stored in the base unit so filters compare like with like |
| `min_value`, `max_value`, `decimals`, `pattern`, `max_length` | numeric, numeric, smallint, text, int | Validation in the form, import and public API |
| `group_code` | varchar(40) | Form section and product page spec-table group (General, Dimensions, Material, Electrical, Compliance) |
| `synonyms` | text[] | Old free-form keys (`Thread Size`, `thread_size`) for the re-keying step and for imports |
| `external_keys` | jsonb `{amazon, google, flipkart}` | Default channel attribute names (overridable per category) |
| `is_system` | bool | Built-ins the code relies on (BIS number, FSSAI licence, net quantity) |

**`attribute_options`**: `attribute_id, value` (canonical slug), `label, sort_order, synonyms, swatch_hex,
image_url, is_active`. Feeds: dropdowns, facet checkboxes, colour swatches, import matching.

**`category_attributes`** (which attributes a category uses, and how):

| Field | Purpose |
| --- | --- |
| `category_id, attribute_id` (PK) | |
| `requirement`: `required`, `recommended`, `optional`, `hidden` | Product form validation and completeness score; `required` blocks publish |
| `inherit` | Applies to descendant categories (set it once on Fasteners, all children get it) |
| `variant_level`: null, 1, 2 | Variant axis (1 = variant, 2 = sub-variant), replacing the free-text `variant_type` / `sub_variant_type` |
| `allowed_option_ids` | Narrows an enum for this category (Screws allow a different head style list from Bolts) |
| `is_facet`, `facet_widget` (`checkbox`, `range`, `swatch`, `toggle`), `facet_order` | Storefront and app filters |
| `show_on_card`, `show_in_compare`, `title_position` | Listing cards, compare table, title template |
| `search_weight`: A–D | Weight inside `products.search_vector` |
| `default_value` | Prefill in the form |
| `channel_overrides` | jsonb, per-category channel attribute names when the library default is wrong |

**Values.** Keep `products.specifications` and `product_variants.attributes` / `product_sub_variants.attributes` as
the store, but keyed by attribute `code` with normalised values (`{"thread_size": "m8", "length": {"v": 25, "u": "mm"},
"material": "alloy_steel"}`). Keys not in the schema survive under an "Additional specifications" group so nothing is
lost. A GIN index (`jsonb_path_ops`) serves equality filters. At today's size (1,201 products) facet counts over the
filtered set are cheap; a `product_facet_values` side table is the escape hatch if a tenant passes ~50k products.

**Vertical templates.** The attribute library and category tree ship as seeds per vertical (industrial hardware
first, from today's catalogue; then apparel, grocery, electronics) in `admin-service/database/seeds/`. Provisioning
offers the template that matches the tenant's declared vertical (the control-plane application already captures
`product_categories`), so a new apparel store starts with size, colour, fit and fabric axes.

### 3.4 AI enrichment of brand and category fields

Product enrichment already works one way: the model proposes, an admin approves. Proposals land in
`product_ai_enrichment_log` (`proposed` → `approved` / `rejected` / `failed`). Only empty fields are filled
(`ENRICH_CONTENT_FIELDS` in `lib/catalog/enrichment-fields.ts`), and an approval promotes the values onto the product
and re-embeds it. Brands and categories get the same flow for the fields in §3.1–§3.3, so 50 brands and 66
categories do not have to be filled by hand.

- **One log for both:** `entity_ai_enrichment_log`, with `entity_type` (`brand`, `category`), `entity_id`, `fields`
  jsonb (proposed value per column), `sources` jsonb (what the model read: website text, product names, HSN
  spread), `model`, `status`, `reviewed_by`, `reviewed_at`, `created_at`. It is owned by admin-service, in
  `tables/ai.sql` next to the product log.
- **Review screen:** the existing catalog-enrichment page gets Products, Brands and Categories tabs. Approve applies
  the proposal through the brand or category draft flow, so it goes through `CONTENT_COLS`, revisions and audit like
  a manual edit.
- **Triggers:** a bulk "Enrich brands / categories" run, an automatic run when a brand or category is created, and
  a per-field "Suggest" button on the forms (the description already has one, `AIEnrichButton`). All of them are
  gated by `RequireAi` plus `brands:write` / `categories:write`.
- **Inputs:** for a brand, its name, website (fetched page text), its products' names and categories, and the
  existing description. For a category, its name, parent, its products' names, specifications and HSN codes, and the
  Google taxonomy path.

What the model may do, per field:

| Role | Brand | Category |
| --- | --- | --- |
| **Draft** (written text, admin approves) | `tagline`, `story`, `description`, `meta_title`, `meta_description`, `seo_content`, `warranty_terms` summary | `tagline`, `short_name`, `description`, `seo_content` (buying guide), `meta_title`, `meta_description`, `category_faqs`, `product_title_template` |
| **Suggest and verify** (facts; the proposal shows its source and stays unchecked until the admin ticks it) | `legal_name`, `aliases`, `country_of_origin`, `founded_year`, `headquarters`, `social_links`, `service_phone` / `service_email` / `service_url`, `default_warranty_months`, `brand_color` (from the logo), logo from the website | `default_hsn_code` and `default_gst_rate` (the most common value among its products, which is deterministic; AI only for empty categories, checked against `hsn_prefixes`), `default_uqc`, compliance flags (`bis_scheme`, `requires_fssai`, `msds_required`, `min_buyer_age`) with a reason, Google category (the auto-match in progress), Amazon product type and Flipkart vertical (Phase 3), banner and image via the existing AI image feature |
| **Never** (human or system only) | `verification_status`, `seller_relationship`, `trademark_number`, `authorization_valid_until`, `map_price_floor_pct`, `default_supplier_id`, brand documents | `restricted_states`, `requires_licence`, margin targets, return policy |

Attribute schema (Phase 2) is where AI saves the most time:

- It proposes a category's attribute set by clustering the `specifications` keys its products already use
  (`Thread Size`, `thread_size` → `thread_size`) and suggesting options from their values. That is the dry-run report
  for the re-keying migration.
- Product enrichment then fills `specifications` by attribute code, choosing only valid options and leaving
  `required` gaps flagged rather than guessed.

Uploaded trademark, BIS or FSSAI certificates (Phase 4) can be read by document extraction to prefill the number,
issuer and expiry on `brand_documents`. The admin still confirms before the badge shows.

---

## 4. Where each piece is used

| Surface | Brand data used | Category data used | Main files |
| --- | --- | --- | --- |
| **Storefront filters** | Brand facet with logos; `aliases` in the brand search box; brand page gets the same facets as a category | `category_attributes.is_facet` decides which filters show, in what order, with which widget (range for length, swatches for colour); option labels and order from `attribute_options`; URL params by attribute code | `product-filters.ts`, `product-attribute-filters-shared.ts`, `FilterSidebar.tsx`, `MobileFilterSheet`, `brands/[slug]/page.tsx` |
| **Product form validation** | Brand defaults shown as inherited values (origin, manufacturer, warranty, lead time); warning when the brand is not approved for the category (`brand_categories`) | Spec section rendered from the schema; `required` blocks publish; enums become selects; units converted; HSN must match `hsn_prefixes`; HSN, GST, UQC, handling, shipping class prefilled; compliance attributes required by `bis_scheme`, `requires_fssai`, `legal_metrology`; only leaf categories offered; completeness score on the list | `ProductForm.tsx`, `product-form/*`, product add / edit actions, `lib/import/*` (same rules for CSV), admin agent `createProduct` |
| **Search** | Brand name and `aliases` into `search_vector` (weight B) and embeddings; brands in autocomplete | Category name and path into `search_vector` (C); attribute values by `search_weight`; "screws m8" resolves to category + facet | `functions.sql` (one search-vector function, drop the duplicate trigger), `embed-products.ts`, `api/(public)/search` |
| **SEO** | Brand page `meta_title`, `meta_description`, `seo_content`, `seo_noindex`; `Brand` / `Organization` JSON-LD with logo, url, `sameAs`; sitemap `lastmod` from `updated_at` | `generateMetadata` on listing pages; `BreadcrumbList` JSON-LD from `path_ids`; `FAQPage` from `category_faqs`; `product_title_template` for product titles; `seo_noindex` respected by the sitemap | `categories/*`, `brands/*`, `products/page.tsx`, product page, `app-shell/sitemap.ts` |
| **Feeds** | `channel_names` for `g:brand` and the Amazon / Flipkart brand string; manufacturer fallback; `brand_categories` as a push pre-check | `category_channel_mappings`: Google category and `product_type` (from `full_slug`), Amazon product type and attribute names (replaces `CATEGORY_PRODUCT_TYPE`), Ajio / Myntra / ONDC codes; `fee_pct` for channel price; `min_buyer_age` → `g:adult` | `feed/google/route.ts`, `lib/merchant/mapper.ts`, `lib/amazon/mapper.ts`, `lib/marketplace/catalog-export.ts`, a new Meta feed if wanted |
| **Invoices and GST** | Manufacturer and country of origin lines where the product leaves them blank; consumer care in the footer | HSN, GST rate, UQC defaults resolved at order commit (snapshotted as today); GSTR-1 HSN summary gets UQC and stops falling back to `9999` | `lib/orders/order-commit.ts`, `gst/gstr1/route.ts`, `document-service/src/lib/invoice-pdf.ts`, quotation and cash-sale PDFs |
| **Storefront brand page** | Banner, logo, tagline, story, facts (founded, HQ, origin), verified / authorized badges, social links, warranty and service contacts, catalogue PDF, category tabs (`brand_categories`), filters | – | `brands/page.tsx`, `brands/[slug]/page.tsx`, `storefront-counts.ts` |
| **Storefront category page** | Brand facet with logos | Hero, tagline, subcategory tiles with images, `seo_content`, FAQ, `listing_layout` (spec table for fasteners), `default_sort`, size or thread chart link | `categories/*`, `listing-model.ts` |
| **Product page** | "Visit the Taparia store" link, logo, badges, warranty and service block, manufacturer / importer / consumer care (Legal Metrology), resolved return policy note | Full breadcrumb, spec table grouped by `group_code`, size chart, compliance numbers (BIS, FSSAI), one resolved return policy | `products/[slug]/page.tsx`, `ProductDetailClient.tsx` (visitor and business) |
| **Homepage and navigation** | Carousel with logos, `is_featured`, `display_order` | Grid and showcase with images; mega-menu from `show_in_nav` and `short_name` | `homepage-model.ts`, `homepage-extras.ts`, `BrandCarousel.tsx`, `CategoryGrid.tsx`, `Header.tsx`, `Footer.tsx` |
| **Checkout and fulfilment** | – | `min_buyer_age` gate, `requires_licence` (B2B only or blocked), `restricted_states` in serviceability, `cod_allowed`, `ships_by_air` for courier choice | checkout routes, serviceability, shipping |
| **Returns** | Brand rule in the one resolver, `return_policy_note` | Category rule, `non_returnable_reason` | `lib/catalog/return-policy.ts` (the only resolver; the product page calls it too) |
| **Mobile app** | Same brand page content and logos | Facets from the schema, category hero, breadcrumbs | `mobile-service/client/src/api/*`, `src/types/index.ts`, `app/brands/*`, `app/category/*`; the storefront `/api/brands`, `/api/categories`, `/api/products/listing` routes it calls |
| **Public API** | `GET /v1/brands`, `/v1/brands/{slug}` | `GET /v1/categories` (tree), `/v1/categories/{id}/attributes` (schema, so integrators can build valid products) | `public-api-service`, types in `packages/api-contracts` |
| **Analytics and B2B** | Revenue, margin and returns by brand id; private-label share | Revenue and margin against `target_margin_pct`; returns by category; `business_discounts` inherit to child categories | `lib/queries/dashboard.ts`, `queries/analytics.ts`, `business-discount.ts` |
| **AI** | Brand fields drafted or suggested through the review queue (§3.4); `story`, `aliases`, `legal_name` feed product enrichment as context | Category fields drafted or suggested (§3.4); proposed attribute sets; product attribute values filled against the schema (valid options only); title from the template | `lib/catalog/enrichment.ts` (generalised to entities), catalog-enrichment page (Brands, Categories tabs), `admin-agent/actions/catalog.ts` (add update actions, go through drafts) |
| **Procurement** | `default_supplier_id`, `default_lead_time_days` for purchase orders and reorder suggestions | `reorder_interval_days` (finally editable) | purchasing prefill, `campaigns/reorder-intervals.ts` |

---

## 5. Resolution rules

One resolver, `resolveEffectiveProduct()` in `packages/store-core/src/lib/catalog/`, used by the storefront, invoices,
feeds, the public API and the mobile API, so the rule is written once. Order: **variant → product → brand → category
(nearest ancestor that sets it) → store default.**

| Value | Product | Brand | Category | Store |
| --- | --- | --- | --- | --- |
| Return / replacement (allowed and window) | 1 | 2: the stricter of brand and category chain, as order time does today | 2 | 7 days |
| HSN, GST rate, UQC, tax class | 1 | – | 2 | 18% today |
| Country of origin, manufacturer, importer, packer, consumer care | 1 | 2 | – | store profile |
| Warranty months and type | 1 | 2 | – | none |
| Lead time | 1 | 2 | – | – |
| Handling days, shipping class, package type, COD | 1 | – | 2 | store default |
| Google / Amazon / Flipkart category | – | – | 1 (mapping row) | – |
| Size chart | – | brand + category, then brand | then category | – |
| Compliance flags (BIS, FSSAI, age, states) | – | – | 1 | – |

Admin screens show inherited values greyed with "from Brand: Taparia" or "from category: Fasteners", so the admin sees
why a value is what it is and can override it.

---

## 6. Phased rollout

Build in this order. Each phase ships on its own and is useful without the next.

### Phase 0: fix what is broken today (no schema change; build this first)

Small, and every item is a bug the audit found, so the later phases do not inherit it.

Status (2026-11-13, uncommitted): items 2–5 are built in the working tree. Item 1 is not: the Merchant files were
being edited by another session, so it was handed over. The return rule now lives in
`lib/catalog/return-policy-rules.ts`: the product window wins, then the stricter of brand and category, where a child
category's own value beats its parent's. The order-detail API used to cap every window at 7 days; it now uses the
same rule.

1. Google Merchant: send `google_product_category` (category, else parent) and `product_type` (category path) in both
   the XML feed and the API sync, using the helpers that already exist.
2. One return-policy resolver: the product page (visitor and business) calls `lib/catalog/return-policy.ts` instead
   of its own inline rule, and the resolver honours `products.return_window_days` first.
3. Search: one search-vector function (drop the duplicate trigger) that adds brand and category names; brand and
   category in the embedding text; brands in autocomplete. Refreshing existing rows is a data change, so it needs a
   small migration (or a re-embed job for the vectors).
4. SEO: `generateMetadata` on `/products`, `/categories`, `/categories/[slug]`, `/brands`, `/brands/[slug]`;
   `BreadcrumbList` JSON-LD on the product and category pages; the full breadcrumb (parent included).
5. Use what is already stored: `BrandCarousel` shows `logo_url`, `CategoryGrid` shows `image_url`, the category page
   shows `hero_image_*`, and the category form gets fields for `hero_image_*` and `reorder_interval_days`.

### Phase 1: brand and category profiles, tax defaults, one resolver

Columns only, plus the resolver. This is where most of the "too little data" complaint goes away.

Status (2026-11-13, uncommitted; schema applied to the local DB only):
- **Fields:** one list per entity drives forms, parsing, drafts and saves (`lib/catalog/entity-fields.ts`,
  `brand-fields.ts`, `category-fields.ts`).
- **Brand defaults:** `lib/catalog/catalog-defaults.ts`. The product page, business portal and app API fill blank
  maker, origin, warranty and lead time from the brand.
- **Tax:** order commit and GSTR-1 fall back to the category's HSN, and GSTR-1's HSN summary now carries the unit
  code (UQC) and quantity.
- **Product form:** prefills tax and shipping fields from the category and warns on an HSN outside the allowed
  prefixes.
- **AI enrichment (§3.4):** `entity_ai_enrichment_log`, `lib/catalog/entity-enrichment.ts`, a "Brands &
  categories" tab on the catalog-enrichment page, and a background proposal when a brand or category is created.
- **Changed from the plan:** the category tree path (`path_ids`, `depth`, `is_leaf`, `full_slug`) is not stored.
  With fewer than 100 categories per store it is computed in code (`resolveCategoryDefaults` and the listing's
  recursive query), which avoids a trigger the schema diff cannot ship.
- **Not built yet:** fetching brand websites for enrichment (the model works from the catalogue and its own
  knowledge, and marks facts "check this"), and the new fields in the brand form's "AI fill form" list.

1. Columns from §3.1 and §3.2 except the channel and compliance enforcement pieces: identity, visuals, origin and
   maker defaults, warranty and service, SEO, `brands.updated_at`; category tree (`path_ids`, `depth`, `is_leaf`,
   `full_slug` with a trigger), display, SEO, tax defaults, fulfilment defaults. `category_faqs` table.
2. Admin: brand and category forms regrouped into tabs (Profile, Media, Origin and legal, Warranty and service, Tax,
   Policy, SEO). A real tree picker for the parent (any depth). Extend `CONTENT_COLS` in `brand-draft.ts` and
   `category-draft.ts`, the add / edit actions and the PUT routes for every new column; the admin agent's create
   actions go through drafts.
3. `resolveEffectiveProduct()` (§5) wired into the product page, order commit (HSN, GST, UQC snapshot), invoice PDFs,
   GSTR-1, feeds and the storefront JSON the app uses.
4. Product form: HSN, GST, UQC, handling and shipping prefilled from the category; inherited values shown greyed with
   their source; only leaf categories selectable.
5. Storefront: brand page (banner, story, facts, social, warranty and service, SEO) and category page (hero, tagline,
   FAQ, `seo_content`, `listing_layout`). Mobile types and screens follow the same fields.
6. Backfill migration: `default_hsn_code` and `default_gst_rate` from the most common product value in each category
   (Screws, Bolts, Nuts → `7318` / 18%), leaving categories with mixed HSN (Hand Tools) for `hsn_prefixes` by hand.
7. AI enrichment for the new columns (§3.4): the `entity_ai_enrichment_log` table, Brands and Categories tabs on the
   catalog-enrichment page, the bulk run and create-time trigger, and approval through the draft flow. Run it once
   over all brands and categories, so the new fields start filled and reviewed rather than empty.

### Phase 2: category attribute schema

The Amazon-style core. Biggest phase; start once Phase 1's resolver exists.

1. Tables `attribute_definitions`, `attribute_options`, `category_attributes` (§3.3). Admin screens: an attribute
   library, and an "Attributes" tab on the category form (pick, set requirement, facet, variant level, order).
2. Seed the industrial-hardware library from today's keys: finish, material, thread type, thread size, salt-spray
   (SST) life, property class, grade, size, diameter, length, head style, drive type, hardness, standard.
3. Re-key migration: `specifications` keys mapped to codes through `synonyms`, values mapped to options, `HSN Code`
   specs moved into `hsn_code` where it is empty, unknown keys kept as additional specifications. Run a dry-run report
   first and review it; the migration must be safe to run twice.
4. Product form renders specs from the schema, enforces `required`, and offers variant axes from `variant_level`
   instead of free text. CSV import gets per-category spec columns with the same validation.
5. Storefront and app filters come from `category_attributes`; numeric range facets; product cards and the compare
   page use `show_on_card` / `show_in_compare`; attribute values join `search_vector` by `search_weight`.
6. AI proposes each category's attribute set from its products' existing spec keys and values (feeds step 3's
   dry-run), then product enrichment fills attribute values against the schema (valid options only) and titles from
   `product_title_template`.

### Phase 3: channels and feeds

1. `category_channel_mappings` and `brands.channel_names`. Move the Amazon `CATEGORY_PRODUCT_TYPE` dictionary into
   rows; `attribute_map` builds the SP-API attributes, which unblocks the SCREWS push in
   `docs/amazon-brand-approval-followup.md` (`thread_size`, `head_style`, `drive_system` come from the schema).
2. Google category and `product_type` read from the mapping; category-specific GMC attributes (size, colour, age
   group) from the schema; Ajio / Myntra / ONDC codes in the marketplace export.
3. `brand_categories` as a push pre-check (no Amazon push for a brand not approved in that category).
4. `fee_pct` for channel price suggestions. Optional: a Meta catalog feed from the same mapping.
5. AI suggests each category's Amazon product type (checked against the Product Type Definitions search) and
   Flipkart vertical, through the same review queue.

### Phase 4: trust and compliance

1. `brand_documents` in the private bucket, a verification queue, expiry reminders through the existing
   notifications, and the Verified brand / Authorized seller badges on the brand page, product page and cards.
2. Compliance flags enforced: BIS number required when `bis_scheme` is set, FSSAI licence, MSDS attachment, age gate
   at checkout, `restricted_states` in serviceability, `ships_by_air` in courier choice.
3. Country-of-origin filter: the origin facet exists; make it searchable and sortable as the 2026 amendment asks
   (from 2027-07-01, if the gazette confirms it).
4. Document extraction prefills certificate number, issuer and expiry on `brand_documents` from the uploaded file;
   the admin confirms before any badge shows.

### Phase 5: reach and polish

1. Public API `v1/brands`, `v1/categories`, `v1/categories/{id}/attributes`, with types in `packages/api-contracts`.
2. `size_charts`, `product_browse_categories` (extra navigation homes), `brand_service_centres`, header mega-menu.
3. Analytics by brand and category id (revenue, margin against target, returns); `business_discounts` inherit to
   child categories and gain brand discounts.
4. Vertical templates at provisioning: the controller seeds the attribute library and category tree for the
   tenant's vertical instead of one starter category.

### Decisions to confirm before Phase 1

1. **Values store.** Keep `specifications` jsonb keyed by attribute code (recommended: no reader rewrite, GIN index,
   fine at our size) rather than a typed attribute-value table.
2. **Library scope.** One attribute library per tenant, seeded from vertical templates (recommended, since tenants own
   their DBs), rather than a shared control-plane library.
3. **Return precedence.** Product first, then the stricter of brand and category chain, which is what order time
   already enforces. The product page will then show shorter windows on some products than it does now.
4. **Brand verification.** In a single-seller store, who verifies? Recommended: the store admin uploads documents and
   the badge shows "documents on file"; a platform-verified badge only if the controller team reviews them.
5. **Commission bands.** Tenants are single-seller stores, so per-category commission only matters as channel fees
   (`fee_pct`). Confirm there is no multi-vendor plan that would need seller commission per category.

---

## Sources

Third-party summaries were used where the platforms' own pages need a seller login; check the official source before
building anything that depends on a specific rule.

- Amazon Brand Registry requirements: [sell.amazon.com](https://sell.amazon.com/blog/brand-registry-requirements),
  [brandservices.amazon.com eligibility](https://brandservices.amazon.com/brandregistry/eligibility)
- Amazon Product Type Definitions API: [reference](https://developer-docs.amazon.com/sp-api/docs/product-type-definitions-api-v2020-09-01-reference),
  [XSD to JSON required attributes](https://developer-docs.amazon.com/sp-api/changelog/reminder-december-2023-product-type-definition-changes-xsd-to-json-migration-requirements)
- Flipkart brand approval: [Fynd brand addition guide](https://documentation.fynd.com/commerce/docs/openapi/new-seller-onboarding/flipkart/brand-addn-flipkart.md),
  [Streamoid seller guide](https://streamoid.com/guide/flipkart-seller-guide)
- Flipkart fees: [GoNukkad commission guide](https://www.gonukkad.com/blog/flipkart-seller-commission-charges),
  [zero commission under ₹1,000](https://www.angelone.in/news/economy/flipkart-drops-commission-fees-for-products-listed-under-1-000)
- Google Merchant Center: [google_product_category](https://support.google.com/merchants/answer/6324436?hl=en),
  [brand](https://support.google.com/merchants/answer/6324351),
  [category-specific best practices](https://support.google.com/merchants/answer/7348545?hl=en)
- Consumer Protection (E-Commerce) Rules 2020: [IndiaLaw summary](https://www.indialaw.in/blog/consumer-protection-e-commerce-rules/),
  [PRS review](https://prsindia.org/billtrack/prs-products/rules-and-regulations-review-3851)
- Legal Metrology and ONDC: [ONDC legal compliance handbook](https://www.ondc.org/legal-compliance-handbook/Brief-Overview.1091010573.html)
- BIS CRS and e-commerce: [S.S. Rana on platform duties](https://ssrana.in/?p=40331),
  [Nemko on CRS](https://www.nemko.com/en-in/product-certification/bis-compulsory-registration-scheme)
- HSN digits on invoices: [Tally on 6-digit HSN](https://tallysolutions.com/gst/guidelines-for-high-revenue-taxpayers-implementing-hsn-codes-in-e-invoices-2/),
  [StudyCafe on GSTR-1 HSN reporting](https://studycafe.in/gst-return-update-what-are-new-hsn-sac-code-reporting-guidelines-378860.html)
- PIM families and variant axes: [Akeneo families and variant families](https://help.akeneo.com/v7-build-your-catalog/v7-manage-your-families-and-variant-families),
  [Akeneo products with variants](https://api.akeneo.com/documentation/products-with-variants.html)
