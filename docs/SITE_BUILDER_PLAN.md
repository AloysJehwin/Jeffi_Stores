# Site Builder: block-based pages and an AI site agent

Status (2026-11-15):
- **Phase 0 done locally:** one layout per surface, via migration
  `admin-service/database/migrations/2026-11-15_homepage_layout_per_surface.sql`.
- **Phase 1 done locally**, behind the per-store `site_builder_enabled` setting, which is off by default:
  - `packages/site-blocks`
  - the site builder tables
  - `packages/store-core/src/lib/site/` (store, legacy import, blocks)
  - `/api/admin/site-builder/*`
  - the theme injected in `RootLayout`
  - brand colours on CSS variables
- **Phase 2 done locally:** the Site Builder editor (canvas with an arrow select tool, block list, inspector, library, templates, theme, AI build/correct), and the Site Builder / Homepage builder tabs with one live.
- **Phase 3 in progress.** Built so far:
  - **3a:** header, footer and announcement bar as site-wide pages.
  - **3b:** About, Contact, Support, Returns and custom `/p/<slug>` pages, with five content blocks.
  - **3c:** product page and cart, each with its core block plus blocks around it.
  - **3d:** sign-in and sign-up (form core with an optional side picture) and account home.
  - **3e:** listing pages (blocks above and below, with the between-products sections inside the Products block) and
    the business portal's About and Support pages.
  - **3f:** template library. 10 page templates and 8 whole-site packs (Heritage Luxury, Warm Festive, Craft Earthy,
    Minimal Modern, Bold Playful, Bazaar Dense, Tech Mono, B2B Pro), applied to a draft in one step; the canvas
    previews the draft's theme. A test validates every built-in template.
  - **3g:** checkout, legal pages (one layout for every policy), search results (`/products?search=`), order
    tracking (`/account/orders/[id]`), and the business portal's catalogue, quotes and orders. Each has a locked core
    block (`checkout_main`, `legal_main`, `search_main`, `track_main`, `catalog_main`, `quotes_main`,
    `orders_main`) with blocks above and below. The built-in page renders unchanged when no Site Builder page exists.
    There are two new page templates: checkout reassurance and tracking help.
- **Phase 4 done locally:** the app home page.
  - `/api/home` carries the store theme's colour variables. The app applies them at runtime with NativeWind, and saves
    them, so a store's colours reach the app without a new build.
  - Content blocks (text, image with text, image banner, questions and answers) can go on home pages. They render on
    the web through the section renderer and in the app as native components.
  - Old app builds ignore the new field and skip the new block types.
  - Limits: the app's fonts are bundled at build time, so a theme's fonts apply on the web only. Colours the app sets
    in code (some icons) keep the built-in palette. The app changes reach phones with the next app build (EAS).
- **Phase 5 in progress.** Built so far:
  - **5a:** "Build my whole site with AI" on the Site Builder start screen (`lib/site/agent.ts`,
    `POST/GET /api/admin/site-builder/ai/site`). From the owner's description, an optional style and up to three
    reference sites (title, description and headings only, read with `fetchPublic`), the AI writes a brief, picks the
    closest store pack and tunes its colours, then rewrites every page's text for the store and its catalogue. Pictures
    for empty image slots are optional (at most 6, off by default). It runs in the background into a new draft and
    records progress on the draft (`docs.ai`); the card polls it and opens the draft when ready.
  - **5b:** onboarding and the first build.
    - **Wizard:** a "Your site" step (step 8 of 9) between Branding and Review. The owner either chooses "Build it
      with AI" (a description, a style card, up to 3 sites they like, pictures on by default) or "I'll design it
      myself". The choice is saved on the draft as `data.site`.
    - **Provisioning:** after go-live, a `build_site` step on k8s calls the store admin's
      `POST /api/cron/site-build`. That route is idempotent and keeps its state in `site_settings.site_ai_build`. It
      imports the store's current layouts, builds into a draft, publishes it, makes Site Builder live and refreshes
      the storefront.
    - **Cost:** paid by the platform through `runPlatformFunded` in `lib/ai/billing.ts`. Usage is priced and logged
      as `platform:site-build` and never debits the store's wallet. The agent stops calling the AI once the budget
      is spent (₹1,000, set by `SITE_BUILD_BUDGET_INR`).
    - **Site Builder page:** shows a "Your AI-built site" banner.
  - **5c:** custom blocks made by the AI (4.3).
    - **Block:** a `composed` content block whose settings are a tree of safe primitives (`lib/site/composed.ts`):
      layout, content, data nodes, and effects (countdown, marquee, image hover swap, fade-in). `cleanTree` drops
      unknown or invalid nodes, caps depth (6) and size (150 nodes), allows only https images, and repairs common
      model slips.
    - **Data:** data nodes store a query that `lib/site/composed-data.ts` turns into bound-parameter SQL, so the
      block stays live.
    - **AI tools (read-only):** `list_categories`, `list_brands`, `search_products`, `get_product`, `list_offers`,
      `top_reviews`, `store_stats`.
    - **Composer** (`lib/site/compose.ts`): a tool loop that runs each distinct lookup once, capped at 12 lookups. It
      gives data nodes that come back empty one repair round.
    - **Rendering:** the web uses `components/visitor/site/ComposedBlock.tsx`; on the home page the data comes with
      the other sections. The app's home renders it natively (`mobile-service/client/.../ComposedBlock.tsx`), with
      products sent as card props.
    - **Editor:** "Make a new block" on the AI tab; "Correct" on a custom block re-composes it. The inspector edits
      the block's words, links and pictures and lists what each data part shows. "Save to my blocks" stores it as a
      `site_templates` row of kind `block`, offered under Add → My blocks.
    - **Local note:** with no paid AI credits locally, the gateway falls back to a small local model, so local
      results are plain. Production uses Claude.
  - **5d:** reference sites and the critique pass.
    - **Reference reading** (`lib/site/reference.ts`): no browser. The page's HTML is cut into its sections (theme
      section wrappers or plain `<section>`s, with overlays, menus and pop-ups dropped), and each is summarised by
      what it holds. Fonts come from the font links and colours from CSS variables. A deterministic classifier turns
      the result into a pattern sequence; the AI's reading is used when it is fuller.
      - Tested on wearcomet.com. The result was announcement, hero with buttons, quick-add product carousel, campaign
        banner, collection tiles, testimonials, press logos, plus its fonts and colours.
    - **Reference home layout** (`lib/site/profile-page.ts`): the site agent lays out the home page from that
      sequence, using our blocks, or AI custom blocks where none fits. It takes the reference's fonts and density but
      keeps the store's own colours.
    - **Critique** (`lib/site/critique.ts`): it flags:
      - blocks that would render empty (no products, reviews or offers behind them);
      - banners without pictures;
      - text too long for its slot;
      - headings on pictures with no overlay;
      - white text on pale brand or accent colours;
      - repeats;
      - phone layouts that are too dense.

      It fixes what it can (removes empty or duplicate blocks, adds an overlay, darkens colours until white text
      reads, has the AI shorten long text) in two rounds at most, and lists the rest for the owner.
      - The site agent runs it after every build and reports what it found, fixed and left.
      - In the editor it is "Check this page" on the AI tab (`POST /api/admin/site-builder/critique`).
      - There are no screenshots: no headless browser runs in store pods. The `Finding` shape leaves room for a
        visual check later.
- **Phase 6 in progress.**
  - Performance:
    - Site Builder pages give priority loading to their LCP image only.
    - Images are responsive (`srcset`/`sizes`), and phones get the banner's phone picture through `<picture>`.
    - Nothing shifts as it loads.
    - Body text is 16 px and buttons are 48 px tall.
  - `/contact` and `/return-policy` now answer with real 307 redirects from middleware when no Site Builder page
    exists (see 7a).
  - **Responsive sweep:** `npm run sweep:responsive`, Playwright against the dev server.
    - It checks every pack's pages at 320–1920 px for overflow, clipped text, tap targets and images without
      dimensions, using throwaway drafts with preview tokens.
    - The CI job "Responsive sweep (advisory)" is non-blocking. Files are in `tests/responsive/`.
  - Dropping the old homepage tables and the Homepage builder is **on hold**: the owner chose to keep both tabs.
- **AI Site Studio (built locally, uncommitted):**
  - The AI writes the whole site as React (TSX) that the store interprets and never executes.
  - It runs live in the onboarding wizard, with one free generation and a gift pop-up.
  - Engaging pages are designed and wired to our parts; non-engaging pages take the theme.
  - Details are in [AI_SITE_STUDIO_PLAN.md](AI_SITE_STUDIO_PLAN.md).

This plan replaces the homepage section editor with a block builder that covers every
customer-facing page on the storefront and the business portal, plus the app's home page. An AI agent builds the first
version of a new store's site during onboarding.

## 1. Where we are today

**Model**
- `homepage_sections` (`admin-service/database/tables/catalog.sql`) holds 32 section types: hero, product_row,
  category_grid, motion_hero, stories, rewards_game, slides, business_* and so on.
- The allowed type values are a CHECK in `admin-service/database/constraints.sql`.
- `hero_slides` keeps a separate set of slides per surface.
- Drafts live in `homepage_draft_branches` as JSON snapshots, published with a three-way merge
  (`lib/catalog/homepage-draft.ts`).

**Editor**
- The editor is `admin-service/.../settings/homepage/page.tsx`, built on `components/admin/homepage/*`.
- `SectionConfigFields.tsx` maps each type to one of about 25 hand-written form editors.
- Preview is an iframe opened with a signed preview token.

**Renderers**
- Web uses a 432-line `switch` in `components/visitor/home/SectionRenderer.tsx`.
- The app (`mobile-service/client/src/components/home/SectionRenderer.tsx`) has its own React Native copy of every
  section.
- Business home and listing pages reuse the web renderer.

**What isn't customizable**
- Every page except home and the in-listing sections is hard-coded React: product page, cart, account, about, contact,
  login and the business portal pages.
- Header nav and footer are hard-coded (`Header.tsx`, `Footer.tsx`), and there is no announcement bar.
- Colors and fonts are compiled in (`packages/design-tokens`), the same for every store. Per store we only have name,
  logo, favicon and meta text.

**AI pieces we already have**
- Text: `aiChat` / `aiChatStream` (`lib/shared/ai-client.ts`), gated by `canUseAi`.
- Images and video: `lib/ai/media.ts` → ai-platform gateway (Gemini/Imagen, Replicate, the razer box), billed through
  `lib/ai/billing.ts` (wallet preauthorize then settle).
- The admin agent's propose/approve tools are the pattern to copy. The agent has no homepage tools today.

**The bug the user hit (must fix)**
- All three surfaces (desktop web, phone web, app) share one row per section. Each surface only gets a visibility switch
  (`config.surfaces`), so `config.aspect`, `config.layout`, `config.sides` and the copy apply to every surface at once.
- Changing a banner's aspect ratio for the app changes desktop too.

## 2. Goals

1. **Every layout is its own document.** No setting leaks between layouts. The layouts are:

   | | Desktop web | Phone web | App |
   |---|---|---|---|
   | Store | every page | every page | home only |
   | Business | every page | every page | home only (the app's business store; drop it if we don't want it) |

   Copying between layouts is an explicit action ("Copy layout from Desktop", or "Apply to other layouts" on one field,
   off by default).
2. **Block building on every customer-facing page.** Blocks from a shared library, added, ordered, nested in columns and
   edited in a live canvas.
3. **The site-wide parts are blocks too.** Header, footer and announcement bar are editable "section groups" per layout.
   Colors, fonts, radius and button style form a per-store theme.
4. **An AI site agent:**
   - In onboarding, the owner describes the store and the agent builds every page from our blocks.
   - It writes copy and generates images in a single art direction (models, mannequins, lifestyle banners, interactive
     cards).
   - The owner keeps editing afterwards, with AI help inside the editor.
5. **Responsive is mandatory.** Every block works from 320 px to 1920 px, and CI proves it.
6. **Rename "Homepage"** in admin to **Site Builder**, with sections Pages, Header & footer, Theme, Assets. The home page
   becomes one page among many (route `/` is unchanged). The page the agent builds during onboarding is installed as the
   home page.

## 3. Architecture

### 3.1 Data model (tenant DB, owned by admin-service; files under `admin-service/database/tables/site-builder.sql`)

**Tables**
- **`site_pages`**: `id, audience (store|business), surface (web|web_mobile|app), page_key, slug, title, seo jsonb,
  doc jsonb, published_doc jsonb, published_at, version, updated_by, timestamps`.
  - Unique on `(audience, surface, page_key, slug)`.
  - `page_key` is one of home, products, category, brand, categories, brands, product (template), cart, checkout,
    wishlist, compare, account, login, signup, about, contact, support, returns, legal, search, track, not_found, custom,
    plus the business keys (quotes, orders, catalog …).
  - `slug` identifies custom pages under `/p/<slug>`.
- **Header, footer and announcement bar**: stored as site-wide pages in `site_pages` (page keys `header`, `footer`,
  `announcement`) per `(audience, surface)`, so they share drafts, publish and history with every other page.
- **`site_theme`**: one row per audience (`tokens jsonb`, draft and published): palette, font pair from a curated
  Google-font list, radius, button style, density, motion level.
- **`site_assets`**:
  - Columns: id, original key, a crop per surface (focal point plus a crop rect per aspect), alt text.
  - Provenance: upload, product, or AI with model, prompt, seed and cost, so AI images are labeled.
- **`site_drafts`**: a named draft covering any set of pages, groups and theme (the editor's working copy), with the
  author and a base version for merge. It replaces `homepage_draft_branches` and reuses `packages/draft-locks`, presence
  and the three-way merge.
- **`site_versions`**: the last 20 published snapshots per page, for one-click rollback.

**Page document**
- Shape: an id map plus an order array, so the AI and the editor can patch one block.
  ```
  { schemaVersion, blocks: { [id]: Block }, order: [id], settings: { background, spacing } }
  Block = { id, type, v, props, children?: { [slot]: [id] }, visibility?: { from?, to?, audience? } }
  ```
- `props` are typed by the block's schema.
- Inside a layout, a block may override props for tablets: `tablet?: Partial<props>` on desktop-web docs. Only typed
  props such as columns, aspect and alignment can be overridden, never raw CSS.
- There are no cross-layout overrides. That is the whole fix for the bleed.

**DB rules (from CLAUDE.md)**
- Drop the `homepage_sections_type_check` CHECK. Block types are validated in code against the registry.
- New tables need no migration. Moving data from `homepage_sections` / `hero_slides` into `site_pages` needs a dated,
  idempotent migration plus a controller fan-out run for tenants.
- Apply to the local DB only. Production goes through `release-db.sh`.

### 3.2 Block registry: one schema, five consumers (`packages/site-blocks`, new)

Each block is one definition:
```
defineBlock({
  type, label, category, icon, pages: [...], audiences, surfaces, singleton?, locked?,
  props: z.object({...}),            // the single source of truth
  fields: { name: { kind, responsive?, aiHint, enum?, bind? } },  // editor + AI metadata
  data?: (props, ctx) => loader key, // product source, category, etc. (reuses homepage-extras loaders)
  presets: [...],                    // what "Add block" offers
  aspectSlots: [...],                // image slots with per-surface default aspect, for the image director
})
```
The same definition drives five things:
1. Server validation on save and publish.
2. Auto-generated property forms in the editor. Hand-written editors are only for rich ones: product picker, slide
   lists, hotspots.
3. The AI tool and structured-output schema, so the agent can only emit valid blocks.
4. The web component map, `blocks/web/<type>.tsx`.
5. The React Native component map, `blocks/native/<type>.tsx`, for app-home blocks only.

The 432-line switch, the `EDITORS` map, the mobile `SIMPLE` map and the CHECK collapse into the registry.

**Block library (first cut)**
- **Structure:** section (background, padding, full-bleed/contained), columns (1–4, stacking on phone), spacer, divider,
  tabs, accordion.
- **Content:** heading, rich text, button group, image, image with text, video, gallery, lookbook, marquee, logo wall,
  stats, FAQ, testimonials, newsletter, social/Instagram strip, store locator / visit us, countdown, map, custom form
  (existing `forms`).
- **Commerce:**
  - Products: product grid/carousel (featured, new, best sellers, on sale, category, manual), single product spotlight,
    shop-the-look (hotspot image), bundles, deal of the day.
  - Discovery: category tiles/circles, brand carousel, collection showcase, recently viewed, back in stock, reviews
    wall.
  - Offers and engagement: offer slider, rewards game, stories, motion hero, slides.
- **Interactive cards:** flip/hover cards, drape/style explorer (swap the image per option), "occasion" picker, before/after.
- **Page-core blocks:** functional pieces a page cannot work without. They are `locked: true`: they can be moved and
  styled but not deleted.
  - Product page: gallery, title/price, variant picker, buy box, delivery check, size chart, tabs (description, specs),
    reviews, related products.
  - Listing: filter bar, product grid, pagination/infinite list.
  - Cart: line items, coupon, summary, upsell row.
  - Checkout: the form and payment stay core and are fixed. Only trust badges, notes and the side panel are blocks.
  - Account: order list, addresses, rewards. Login/signup: form, side image and copy.
  - Search results and order tracking: new pages we don't have today.
- **Business:** quick-order grid (SKU and qty paste), tier price table, reorder last order, quote request, quotes list,
  GST invoice list, credit/balance card, account-manager card, GSTIN/tax info, bulk catalogue download.

All 32 current section types map onto these blocks, most of them 1:1, and their components are reused.

### 3.3 Rendering

**Web**
- A `PageRenderer` loads the published doc for `(audience, surface, page)`. The surface comes from the existing
  `getWebSurface`: phones get `web_mobile`.
- It batches block data with the existing model and extras loaders, and renders via the registry.
- Caching: the doc is cached in Redis per tenant + key, the same pattern as `homepage-layout.ts`, and invalidated on
  publish with `revalidatePath`.
- Theme: `RootLayout` injects the store's theme as CSS variables, plus the font pair via `next/font` from a fixed list.
  This replaces the compiled-in colors for storefront and business. Admin keeps its own theme.
- Chrome: header, footer and announcement render from their site-wide pages. The hard-coded `Header`/`Footer` links
  are the defaults when a store has none.

**App**
- `/api/home?surface=app` returns the app home doc plus resolved data plus the theme tokens. The app applies the theme
  at runtime, not from compile-time tokens.
- Unknown block types are skipped, so older builds keep working (the same rule as `LEGACY_APP_HIDDEN_TYPES`).
- Feature flag: a `site_builder` per-tenant switch picks the new renderer, so the rollout is per store.

### 3.4 Editor (admin → Site Builder)

**Layout:** three panes.
- Left: pages, and the layer tree of the current page.
- Centre: the live canvas. An iframe of the real renderer with the draft token; click a block to select it, via
  `postMessage`.
- Right: the property form generated from the schema.

**Toolbar:**
- Store / Business, then Desktop / Phone web / App (each its own document), the page picker, Undo/redo and
  Preview-at-width (360, 390, 768, 1024, 1440).
- "Copy layout from…" plus Publish / Schedule.

**Library:**
- Drag a block or preset in, or drop it into a column slot. Saved sections ("my blocks") can be reused across pages.

**Per-field controls:**
- A "tablet override" toggle on desktop docs for responsive fields.
- A small "Also apply to: Phone web / App" checkbox, off by default. It is the only way a change crosses layouts.

**AI in the editor:**
- On a block: "Rewrite", "Translate", "Generate image" (with the slot's aspect per surface), "Suggest a block here".
- On a page: "Build this page with AI" and "Redesign this page".
- Admin agent tools follow the existing propose-then-approve envelope: `propose_page_change`, `propose_theme`,
  `generate_site_image`.

**Kept from today:** draft locks, presence, the merge screen, scheduling (`starts_at`/`ends_at` become block
visibility) and the plan gating from `homepage-plan.ts` (blocks carry `plan`).

### 3.5 Prebuilt templates

A template is a ready-made page document (or a set of them), so owners can start any page from a design instead of a
blank canvas.

- **Page templates:** several for every page type on every layout. Types: home, listing, category, brand, product page,
  cart, account, login, about, contact, support, returns, legal, search, order tracking, custom landing pages, and every
  business portal page.
  - Each is tagged by archetype (Heritage Luxury, Warm Festive, Minimal Modern …), category (fashion, beauty,
    electronics, hardware …) and audience (store, business).
- **Site packs:** a whole site in one style. That is every page on all six layouts plus the header, footer and theme. For
  example "Heritage Luxury", "Bazaar Dense", "B2B Pro".
- **Content:**
  - Templates bind to the store's own data: product, category and brand blocks pull real catalogue items, and the
    store name and logo fill in automatically.
  - Images and copy are placeholders that the owner, or AI, replaces.
  - Applying a template never touches the catalogue.
- **In Site Builder:**
  - "Start from a template" on any page and layout.
  - "Apply a site pack" to the whole site.
  - "Save as my template" to reuse a page the owner built.
  - All three write to the draft, with a confirm before replacing anything; nothing goes live until publish.
- **Storage:** built-in templates ship as JSON in the repo (`packages/site-blocks/templates/`), validated against the
  block registry in CI. Owner templates are saved in a `site_templates` table in the tenant DB.
- **AI:** the site agent starts from the best-matching site pack and template, then adapts the copy, images and block
  choices to the brief. The templates double as the agent's reference library ("past experience").

## 4. The AI site agent

### 4.1 Onboarding stage

**Where:** a new wizard step "Your site" after Branding in `controller-service/.../ecom/onboard/steps.ts` (Review moves to
8). It captures:
- A free-text description: what they sell, who for, the mood.
- 0–3 reference URLs they like.
- A style pick from 6–8 archetype cards (each shows a thumbnail).
- Optional product photos.

**When it runs:** after payment, as a provisioning step `build-site` in `lib/provisioning/steps.ts`. Generating during
an unpaid wizard wastes AI money. The Setup screen shows progress ("Writing your home page… generating 6 images…").

**The result:**
- The site is published as the store's starting site, so the store is never empty.
- The owner lands in Site Builder with a "Your AI-built site" banner, and can regenerate any page or block.

**Cost:** a capped platform-funded budget per new store (open question: amount). After that, the tenant's AI wallet
pays. The flagship is free.

### 4.2 Pipeline (an orchestrator with tools; a resumable background job)

1. **Brief:** structured extraction from the description.
   - Category, sub-category vocabulary ("Kanjivaram, Banarasi, organza" rather than "premium products"), audience,
     price tier, tone and language.
   - The palette comes from the logo (colour extraction), and from reference URLs via a screenshot and a vision model
     (style cues only, never copied content).
2. **Archetype:** pick one of 8 hand-designed archetypes. Each is a theme (font pair, palette rules, radius, density,
   motion) plus page recipes per page and layout. The archetypes:
   - Heritage Luxury (Sabyasachi / Raw Mango feel)
   - Warm Festive (Taneira)
   - Craft Earthy (Fabindia / Suta)
   - Minimal Modern
   - Bold Playful
   - Bazaar Dense (Nykaa-style promo)
   - Tech Mono
   - B2B Pro (business portal)
3. **"Past experience":** a reference library of 20–30 exemplar sites rebuilt *in our own block format*, tagged by
   archetype and category. They are few-shot examples for the recipe and copy steps. We grow it as we build good store
   sites, and the best published tenant sites can be added with consent.
4. **Copy:** Claude fills every block's text from the brief, in Indian-English or the store language, using the block
   `aiHint`s.
5. **Images:** an image-director sub-agent.
   - It lists every image slot with its aspect per surface (`aspectSlots`), so desktop and phone get their own crops.
   - It writes one shared art-direction prompt plus a seed for the whole site. Mixed styles are the biggest "AI site"
     tell.
   - It generates through `lib/ai/media.ts`: models wearing the product and mannequins, using the owner's product photos
     as references when present, plus lifestyle banners and interactive-card art.
   - Every result is stored in `site_assets` with provenance.
   - Generated people are used for banners and lifestyle, never as the product page's product photo.
6. **Assemble:** build every page doc from the recipe and validate it against the registry schemas. Business recipes
   add quotes, GST/tax info, reorder and tier pricing blocks.
7. **Critique:** render each page at 390, 768 and 1440 with headless Playwright. A vision model checks contrast, empty
   or broken blocks, overflow, text on busy images and repetition. It fixes up to 2 rounds.
8. **Publish** the result and write a short "what I built" summary for the owner.

**Tools the orchestrator gets:**
- `list_blocks`, `get_block_schema`, `get_archetype`, `get_examples`
- `write_page(doc)`, `generate_image(slot, prompt, aspect, refs)`, `render_preview(page, surface)`, `critique(screenshot)`
- `get_catalog_summary`: the categories and products the store already has, so blocks bind to real data.

Every call is logged and billed per step (feature keys `site_build_text` and `site_build_image`), with hard caps on
image count and spend.

### 4.3 AI-composed blocks ("make a new component")

The AI can create a block that does not exist yet, from the store's own data. It never writes code into the store.

**What it builds:** a new block type, `composed`, whose settings are a tree of safe primitives:
- **Layout:** section, grid (columns per surface), stack, columns, carousel.
- **Content:** heading, text, image, button or link, badge, icon, spacer, divider, video.
- **Data-bound:** product cards, category tiles, brand logos, a review quote, offer tiles, a countdown.
- **Effects:** hover image swap, marquee, fade-in.

**Why it stays safe:**
- Styling uses only the theme tokens and a short list of style options (alignment, spacing scale, radius, tone, and aspect ratio per surface). There is no raw HTML, CSS or JavaScript.
- So it cannot inject scripts, it stays on-brand, and it is responsive by construction.

**Store data the AI can read:**
- The tools are read-only, scoped to the store, and use a small query language, never SQL: `list_categories`, `list_brands`, `search_products` (category, brand, price, tags, on sale, new, best sellers, in stock, limit), `get_product`, `list_offers`, `top_reviews`, `store_stats`.
- A block stores the query, not the results, so it stays live as products change.

**Flow:**
1. The owner asks, for example, "a lookbook of three festive sarees with shop-the-look hotspots".
2. The agent calls the data tools and returns a primitive tree.
3. The tree is validated against the primitive schema, with depth and size caps.
4. The block appears in the preview, and the owner edits it in the inspector.
5. "Save as my block" adds it to the block library for reuse.

**Rendering:** web renders every primitive. The app's home page renders a subset with native components.

### 4.4 Generating sites from references

The owner can paste sites they like, for example https://www.wearcomet.com/. The agent builds a site in that style
with the store's own products and images. It never copies their text, images or brand.

1. **Read the reference:**
   - Fetch the page and take headless screenshots at 390 px and 1440 px. The fetch uses limits and sends no credentials.
   - A vision model extracts a reference profile: the block sequence, interactive patterns, type and colour feel, image aspect ratios and rhythm, and density.
2. **Map the profile to blocks:** where no block fits, the agent composes one (4.3), so any reference can be approximated.
3. **Fill it:** add the store's data and generated images in one art direction, then run the critique pass (4.2, step 7).

**Example profile, wearcomet.com (from its homepage):**
- Rotating announcement strip with a discount code.
- Image-only full-width hero with two calls to action (men / women).
- Product carousel: hover image swap, badges (new in / restocked / pre-order), quick-add with colour and size.
- Campaign banner, then four-up collection tiles with "Shop now".
- Customer-photo testimonials slider.
- "As appreciated on" press logo marquee.
- Referral banner and a back-in-stock form.
- Footer with a tagline and link columns.
- Style: image-led, short uppercase labels, airy full-bleed spacing, a restrained number of sections.

**Blocks this tells us to add to the core set:**
- Product card with hover swap and quick add.
- Press logo marquee.
- Customer-photo testimonials.
- Collection split tiles.
- Back-in-stock form.
- Mega menu with image tiles.
- Image-only hero with two calls to action.

## 5. Responsive guarantee

- **Block contract:**
  - Fluid layout only. Type uses `clamp()`; body text is at least 16 px; tap targets are at least 48 px.
  - Images use `<picture>` with per-surface crops and focal point, AVIF/WebP and explicit `sizes`, inside aspect boxes
    so nothing shifts as it loads.
  - The hero's LCP image is eager with high fetch priority.
- **Defaults per layout:** the phone web doc defaults to 2-column grids, 4:5 heroes and swipe carousels with a peek of
  the next card. Desktop uses 4-column grids and 16:9 or 21:9 heroes. Tablet uses the desktop doc with its overrides.
- **CI sweep (new, required):**
  - Render every block preset, and every archetype's pages, at 320, 360, 390, 768, 1024, 1280 and 1920.
  - Fail on horizontal overflow, clipped text, tap targets under 48 px or images without dimensions.
  - Keep a small screenshot diff set per archetype.

## 6. Delivery phases

Each phase ships behind the `site_builder` flag and keeps the existing tests green.

| Phase | What ships | Size |
|---|---|---|
| **0. Bug fix now** | Split shared section rows into one row per surface. A migration copies each row to every surface where `config.surfaces` is on, then drops `config.surfaces`. The editor edits one surface at a time, and "Copy to other surfaces" is explicit. Fixes the aspect-ratio bleed on today's homepage before the builder lands. | S |
| **1. Foundation** | `packages/site-blocks` (registry, schemas, the 32 existing types as blocks, template format); `site_pages`, `site_theme`, `site_assets`, `site_drafts`, `site_versions`, `site_templates`; draft/publish/rollback; web `PageRenderer`; theme CSS variables; data migration from `homepage_sections` / `hero_slides`; flag. | L |
| **2. Editor** | Site Builder admin: canvas selection, schema forms, library, columns, layouts, undo, copy-from, publish/schedule, locks, presence, template picker and "save as my template". Rename in nav. | L |
| **3. Every page** | Built-in templates and site packs for every page × layout across the archetypes; page-core blocks plus page layouts for the product page, listing, cart, checkout (side panel), account, login, about, contact, support, returns, legal, custom pages, and the new search and order-tracking pages; header/footer/announcement groups; all business portal pages with business blocks. | XL |
| **4. App home** | Native block map from the same registry, runtime theme, `/api/home` doc payload, old-build fallback. | M |
| **5. AI agent** | Archetypes and reference library, the pipeline and tools, image director, critique loop, onboarding step, `build-site` provisioning job, admin-agent tools; AI-composed blocks with read-only store-data tools (4.3); generating sites from pasted references (4.4). | XL |
| **6. Harden** | CI responsive sweep across archetypes, performance budget (LCP, CLS), drop the old tables and editor, docs. | M |

Order: 0 now. Then 1 → 2 → 3, with 4 able to run beside 3. 5 can start once 1 is in (it needs only the registry and
docs), and 6 runs last.

## 7. Risks

- **Scope:** "every page" is large. Page-core blocks keep checkout and payment safe: they can be moved and styled, not
  removed.
- **Two renderers:** the app keeps its own React Native components. Limiting the app to the home page keeps that small.
- **AI cost and quality:** caps per store, one art direction per site, the critique loop, a regenerate button, and a
  label on AI images.
- **Old app builds:** keep `/api/home` backward-compatible, and skip unknown types.
- **Migration:** run per tenant through the controller fan-out, keep the old tables read-only for one release, and roll
  back with the flag.

## 7a. Known issues

- **Fixed 2026-11-17:** middleware now sends the 307 for `/contact` and `/return-policy` when the store has no
  Site Builder page for them. The page's own `redirect()` remains as a fallback.
- **Was:** page redirects in the storefront arrived as a 200 with a client-side refresh, not a 307. Examples: `/contact` to
  `/support`, and `/return-policy` to the legal page.
  - This predates Site Builder: the original `redirect()` pages behave the same, because the root layout streams before
    the page throws.
  - Fixing it means moving such redirects into middleware or route handlers.

## 8. Decisions (owner, 2026-11-15)

1. **Six layouts**, each its own document: store and business × desktop web, phone web and app (app = home page only).
2. The admin section is called **Site Builder**.
3. The platform covers **₹1,000 of AI spend per new store** for the onboarding build; after that the store's AI wallet pays.
4. Reference library: start from the **researched list** (Sabyasachi, Taneira, Raw Mango, Suta, Fabindia, Nykaa
   Fashion and similar). The owner may add sites later.
5. The **business home is built separately by the agent**, with quotes, GST/tax info, reorder and tier pricing blocks.
   It is not a copy of the store home.
