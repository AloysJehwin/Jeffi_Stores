# AI Site Studio: a live, AI-written store site at onboarding

Status (2026-11-18): **built locally, uncommitted.** Every part (A–F below) is done and checked at route and unit
level against the local database with scripted model replies. Not yet seen in a browser, and no real AI generation
yet: the AI gateway wasn't reachable during the build. Read docs/SITE_BUILDER_PLAN.md first: the Studio builds on
Site Builder (page documents, blocks, theme, drafts, publish).

**Where the build differs from the contract below:**
- **Code engine:**
  - `compileSection` is async, because Tailwind's PostCSS is. `checkSection` is the sync validation used in repair
    loops. `CompiledSection` also has an `id` (`cs-<hash>`), which is the CSS scope.
  - Allowed links also include `#anchor`, `mailto:` and `tel:`. `LIST.map(...)` over literal or bound lists is
    allowed.
  - The renderer re-checks everything and caps lists at 60 items and sections at 4000 elements.
  - `CodeSection` takes `{ section, id?, page?, data?, priority? }`.
- **Page parts:**
  - On checkout, `ContactForm` and `AddressForm` are read-only (the address is chosen on `/checkout/review`), and
    `CouponBox` is read-only too (the coupon is applied in the cart).
  - `NewsletterForm` renders nothing, because there is no public subscribe endpoint.
  - `PaymentStep` wraps the unchanged payment flow (`parts/checkout/context.tsx`). A test
    (`tests/components/checkout-parts.test.tsx`) proves the order request is identical through the built-in and an
    AI-arranged checkout.
  - Cart and checkout pages add the built-in part back when an AI page lacks a required part.
- **Studio (onboarding):**
  - Brief (5 questions) → pages → look (3 directions) → live build (SSE) → preview and tweak.
  - The free generation is once per owner, capped at ₹1,000 across requests (every page, including category, brand, account and policy pages, plus the site product card; later full generations from Site Builder are charged to the AI wallet, at most ₹1,500) (`site_studio_sessions.spent_inr`). Site generation runs on Opus (gateway hint `deep`; copy work on Haiku) and its pictures on the cheapest image model (`quality: draft`: the Razer box, else `gemini-3.1-flash-lite-image`).
  - Tweaks are free up to 30 a day (`SITE_STUDIO_TWEAKS_PER_DAY`).
  - Up to 6 sample product pictures are made, with `generateImage({ skipGallery: true })` so they never enter a
    gallery.
  - Preview URL: `/ecom/onboard/studio/preview/<session>/<page>?surface=…&preview=1`.
  - Business quotes are themed only.
- **Themed pages:** the style tokens become `--ui-*` variables, read by `ui-*` hook classes (globals.css) on the
  account, orders, auth and legal pages. With no style tokens set, those pages render exactly as before.
- **Layout:** a store's AI header, footer and announcement replace the built-in ones (RootLayout → ConditionalLayout,
  `loadCodeChrome`).
- **Runtime dependencies added:** `@babel/parser`, `tailwindcss` and `postcss` (moved out of devDependencies).
  `tailwindcss` is in `serverExternalPackages`.

**Still open:**
- A browser walkthrough of the studio.
- One real generation with Claude, to judge design quality.
- An interactive (not inert) cart in the studio preview.
- A Site Builder editor inspector for code sections (view and edit the code; "Change with AI" exists in the studio
  only).

## 1. What the owner gets

In the onboarding wizard's "Your site" step, the owner describes the store and watches the AI build the whole site
right there. It covers every page, on desktop and phone, with sample products so it looks real. The flow is Tempo-like:

1. **Brief.** 3–5 questions: what they sell, who for, the mood, sites they like, logo. "Help me answer" and "Skip" are offered.
2. **Page plan.** The pages the store gets, split into **engaging** pages (designed by the AI) and **non-engaging**
   pages (they take the theme). The owner can toggle optional pages.
3. **Design direction.** Three directions, each with a palette, a font pair rendered in its fonts, and a layout feel.
   "Shuffle colours" and "new direction" are available, plus a free-text override.
4. **Live build.** Pages stream in one by one into a preview with a desktop/phone toggle. Home is built first.
5. **Tweak.** Select a section and tell the AI what to change, or regenerate one page.
6. **Done.** The site is saved with the application. After payment and provisioning it is installed into the new store
   and goes live with the store; the sample products are dropped and real ones replace them.

**Free generation.** Every new owner gets one free full-site generation. An animated, non-blocking "gift" pop-up
announces it: a card that springs in at the corner, not a page blur. Small tweaks stay free (capped per day). Another
full generation needs the subscription and is paid from the AI wallet. Decided by the owner, 2026-11-17.

## 2. Engaging vs non-engaging pages

| | Store | Business portal |
|---|---|---|
| **Engaging** (AI writes each section as React code, wired to our components) | home, products/category/brand listing, search results, product detail, cart, checkout, header, footer, announcement, about, contact | home, catalogue, product detail (shared), quotes |
| **Non-engaging** (theme only: colours, fonts, radius, density, component style tokens) | account, orders and order detail/tracking, transactions, addresses, rewards, referrals, subscriptions, wishlist, compare, login/signup, legal, returns, not found | account, orders, sign-in/sign-up, pending |

Checkout is fully designed around a **locked payment step** (`<PaymentStep />`). The AI cannot change or omit that
step; the validator requires it exactly once on the checkout page. Owner decision, 2026-11-17.

## 3. The AI writes React (TSX); we never execute it

Owner decision, 2026-11-17: "AI writes React code", like Tempo. To keep every store safe, a store **interprets** the
code instead of running it:

- The AI writes one TSX component per page section, styled with Tailwind classes.
- On save, `compileSection(source)` parses it with `@babel/parser` and validates it against the allowlist below:
  - Elements: allowed HTML tags and the component library.
  - Attributes: an allowed set, with literal or bound values.
  - Expressions: literals, members of render-prop parameters, `&&`, ternaries, template literals.
  - It then stores a JSON AST.
- The storefront renders that AST with an interpreter: no `eval`, no `new Function`, no bundling of AI code.
- Tailwind classes in the code are compiled at save time into CSS scoped to the section and stored with it.

Not allowed:
- Event handlers, refs, spreads, `dangerouslySetInnerHTML`, `style`, `script`/`iframe`/`object`/`form` tags, and
  `import` other than the component library.
- Function calls other than a render-prop arrow, identifiers not bound by a render prop, and URLs other than `https:`
  or same-site `/paths`.

Caps: 30 KB of source, 400 JSX nodes, depth 20. Interactivity comes from library components (carousel, tabs,
accordion, marquee, reveal, countdown, add to cart, variant picker…), never from AI-written logic.

## 4. Module contract (every part builds against this)

### 4.1 Code engine: `packages/store-core/src/lib/site/code/`
```ts
// compile.ts
export interface CompiledSection { ast: CodeNode; classes: string[]; css: string; components: string[] }
export interface CompileIssue { message: string; line?: number }
export function compileSection(source: string, ctx: { page: PageKey }): { ok: true; section: CompiledSection } | { ok: false; issues: CompileIssue[] }
// ast.ts
export type CodeNode =
  | { t: 'el'; tag: string; props: Record<string, CodeValue>; children: CodeNode[] }      // allowed HTML tag
  | { t: 'cmp'; name: string; props: Record<string, CodeValue>; children: CodeNode[]; render?: { param: string; body: CodeNode } } // library component
  | { t: 'text'; value: string }
  | { t: 'expr'; value: CodeValue }                                                       // {p.name}
  | { t: 'cond'; test: CodeValue; then: CodeNode; else?: CodeNode }
export type CodeValue =
  | { k: 'lit'; v: string | number | boolean | null | Record<string, unknown> | unknown[] }
  | { k: 'path'; root: string; path: string[] }                                           // p.price.formatted
  | { k: 'tpl'; parts: (string | CodeValue)[] }
  | { k: 'not' | 'bool'; v: CodeValue } | { k: 'eq'; a: CodeValue; b: CodeValue } | { k: 'cond'; test: CodeValue; then: CodeValue; else: CodeValue }
// css.ts — Tailwind v3 + the shared preset (packages/store-core/tailwind.preset.ts); preflight off; every rule scoped
export function compileSectionCss(classes: string[], scope: string): Promise<string>
// library.ts — the component library the AI may use
export interface CodeComponentDef {
  name: string                         // JSX name, PascalCase
  pages: PageKey[] | 'any'
  props: z.ZodTypeAny                  // literal props schema
  binding?: Record<string, string>     // render-prop parameter fields → description (for the AI and the validator)
  required?: PageKey[]                 // pages that must contain it (e.g. PaymentStep on checkout)
  describe: string                     // one line for the AI prompt
  render: (props: Record<string, unknown>, ctx: RenderCtx) => ReactNode | Promise<ReactNode>
}
export function defineCodeComponent(def: CodeComponentDef): CodeComponentDef
export function codeLibrary(): Map<string, CodeComponentDef>
export function describeLibrary(page: PageKey): string   // prompt text: every component allowed on the page, props and bindings
```
The library's own index imports the part modules: `parts/common.tsx` (engine), `parts/product.tsx`,
`parts/listing.tsx`, `parts/cart.tsx`, `parts/checkout.tsx` and `parts/chrome.tsx`. Each one calls
`defineCodeComponent` at module load.

### 4.2 Rendering: `packages/store-core/src/components/visitor/site/code/`
- `CodeSection.tsx` is a server component: `<CodeSection section={CompiledSection} />`. It interprets the AST, runs
  data components through `siteData()`, renders library components, and puts `<style>` with the section's CSS
  inside a `data-code-section="<id>"` wrapper.
- `islands/*.tsx` are client components for carousel, tabs, accordion, marquee, reveal and countdown.
- A new block type `code_section` holds `{ label, source, compiled: CompiledSection }`. It is registered in
  `lib/site/blocks.ts`, allowed on every engaging page, and rendered by `ContentBlock` and `SectionRenderer` as
  `<CodeSection>`.

### 4.3 Data source: `packages/store-core/src/lib/site/data/`
```ts
export interface SiteData {
  products(q: ProductQuery): Promise<ProductView[]>; product(slug: string): Promise<ProductDetailView | null>
  categories(q: { parent?: string | null; slugs?: string[]; limit: number }): Promise<CategoryView[]>
  brands(q: { slugs?: string[]; featured?: boolean; limit: number }): Promise<BrandView[]>
  reviews(q: { productSlug?: string; minRating: number; limit: number }): Promise<ReviewView[]>
  offers(q: { limit: number }): Promise<OfferView[]>; store(): Promise<StoreView>
}
export function runWithSiteData<T>(src: SiteData, fn: () => Promise<T>): Promise<T>  // AsyncLocalStorage
export function siteData(): SiteData                                                 // the DB source when none is set
export function dbSiteData(): SiteData                                               // from lib/site/composed-data.ts queries
export function sampleSiteData(catalog: SampleCatalog): SiteData                     // onboarding preview
```
The `ProductView` fields are the `<Products>` binding: `id, slug, name, url, image, hoverImage, price, mrp,
discountPct, badge, brand, category, inStock, rating, reviewCount`. Prices are pre-formatted strings plus numbers.

### 4.4 Page parts (wired components)
Each part reuses the existing component and its client state; it does not re-implement it. Each page's provider
(product, cart, checkout) is mounted by the page itself, so parts in any order share state.
- **Product page:** `Product` (render-prop binding), `ProductGallery`, `ProductTitle`, `ProductPrice`, `ProductRating`,
  `VariantPicker`, `QuantityPicker`, `AddToCart` (required), `BuyNow`, `WishlistButton`, `DeliveryCheck`,
  `ProductDescription`, `ProductSpecs`, `ProductReviews`, `RelatedProducts`.
- **Listing and search:** `Filters`, `SortMenu`, `ResultCount`, `ProductResults` (required; infinite list,
  render-prop card).
- **Cart:** `CartLines` (required), `CartSummary`, `CouponBox`, `FreeShippingProgress`, `CheckoutButton` (required),
  `CartEmpty`, `CartUpsell`.
- **Checkout:** `ContactForm`, `AddressForm`, `DeliveryOptions`, `OrderSummary`, `CouponBox`, `TrustBadges`,
  `PaymentStep` (required, exactly once, locked).
- **Chrome:** `Logo`, `NavLinks`, `SearchBox`, `CartIcon`, `AccountLink`, `AnnouncementText`, `FooterLinks`,
  `SocialLinks`, `NewsletterForm`.
- **Common** (engine): `Products`, `Categories`, `Brands`, `Reviews`, `Offers`, `Store`, `ProductCard`, `Image`,
  `Link`, `Icon`, `Carousel`, `Tabs`/`Tab`, `Accordion`/`AccordionItem`, `Marquee`, `Reveal`, `Countdown`.

### 4.5 Generation pipeline: `packages/store-core/src/lib/site/studio/`
```ts
brief(answers): Promise<StudioBrief>
plan(brief, audiences): Promise<StudioPlan>                 // engaging pages with section intents; non-engaging list
directions(brief, n = 3): Promise<DesignDirection[]>        // ThemeTokens + style tokens + layout feel + rationale
sampleCatalog(brief): Promise<SampleCatalog>                // categories, 12–24 products (image prompts), brands, reviews
generatePage(ctx, page, onEvent): Promise<PageDoc>          // section by section: TSX → compileSection → repair (≤2) → code_section block
tweakSection(ctx, block, instruction): Promise<Block>
installStudioSite(session, adminId): Promise<void>          // into the store's site_drafts → publish → flag on
```
- Each section prompt gets the brief, the chosen direction, `describeLibrary(page)`, and the page's required parts.
- Code is responsive with Tailwind breakpoints, so one source serves desktop and phone. The same document is saved for
  `web` and `web_mobile`.
- Variety comes from the brief, the direction and per-page layout choices. There are no fixed templates; site packs
  and reference profiles are inspiration only.
- AI cost runs inside `runPlatformFunded` (lib/ai/billing.ts) for the free generation.

### 4.5a Safety on every save
Compiled ASTs are never trusted from storage or a client. `recompileCodeSections(doc): Promise<PageDoc>` in
`lib/site/code/compile.ts` recompiles every `code_section` from its `source`. `saveDraftPage` in
`lib/site/store.ts` calls it, and so does `installStudioSite`. The renderer also skips any tag or component outside
the allowlist (defence in depth).

### 4.5b Theming the non-engaging pages
`ThemeTokens` (packages/site-blocks/src/theme.ts) gains style tokens: `buttonShape`, `cardStyle` (flat, outlined,
shadow), `inputStyle`, `headingCase` (normal, upper), `headingTracking` and `shadow`. `themeCssVars` emits them as
CSS variables. The shared visitor UI primitives used by the account, orders, transactions, profile, auth and legal
pages read those variables, so the chosen direction carries over with no AI per page. Directions (4.5) set these
tokens.

### 4.6 Onboarding studio (controller-service, ecom portal)
- **Storage (control plane):** `site_studio_sessions` holds owner_id, status, brief, plan, directions, chosen
  direction, catalog, pages (key → PageDoc), theme, `free_used_at`, tweaks_today and timestamps. The table goes under
  `controller-service/database/control-plane/` in the usual shape.
- **API:** `/api/ecom/onboard/studio/*` covers start, answer, plan, directions, choose, generate (SSE progress),
  tweak and regenerate-page.
- **Preview:** `/ecom/onboard/studio/preview/[session]/[page]?surface=web|web_mobile`. It renders the session's pages
  through `CodeSection` and the theme, with `runWithSiteData(sampleSiteData(catalog))`, inside an iframe in the
  wizard with a desktop/phone toggle.
- **Wizard:** the "Your site" step becomes the studio. A gift pop-up (animated corner card) announces the free
  generation, and a "Free generation" chip stays on the step.
- **Provisioning:** `build_site` installs the session's site instead of generating one. It POSTs
  `{ studio: { pages, theme } }` to the store admin's `/api/cron/site-build`, which calls `installStudioSite` (part D
  extends that route). The older brief-only path stays as a fallback.
  - It also sends the session's `brief`, `plan` and `direction`; the install stores them in the store DB as one
    `site_settings` row, key `site_studio_context` (`lib/site/studio/context.ts`), so Site Builder's "Change this
    section" runs `tweakSection` the studio way (billed to the store's AI wallet). Stores without it use their name
    and published theme.
- **Business catalogue:** uses the listing parts (part B). Business quotes are themed-only for now.
- **Design style and sites they like:** the brief asks for a design style (`studio/ui-styles.ts`: Minimalist,
  Brutalist, Editorial, Luxury, Playful, Bold poster, Warm & crafted, Bazaar, Soft & friendly, or let the AI choose),
  each card a live mini storefront in its fonts, buttons and cards (`_studio/StylePreview.tsx`).
  - A picked style fixes the shape tokens of all three looks (only colours and its own font pairs vary) and its rules go
    into every section prompt (`briefText`).
  - A site they like is read for its brand colours (backgrounds, `rgb()`, Shopify RGB variables, brand-first),
    fonts (by use, mapped to the closest theme font) and layout feel; the first page is read up to 2.5 MB. The first
    look is built from it ("Like <site>", in the picked style: the site's colours and body font), and its layout feel
    and section rhythm go into the section prompts. The Pages step shows what was read ("From the sites you like").
- **Live-store safety:** sections are written over the sample catalogue but go live on the store's own, which starts
  empty (the sample catalogue is never installed).
  - Rendering (`CodeSection`): data components report a `count`; a section of only store data that is all empty
    hides (never the page's first block, never in the Site Builder editor), as do tabs of only empty data. Links and
    menu items to a category or brand the store lacks go to `/products` (menus drop the item). An `<Image>` without
    a src is a quiet brand fill on the live store. `NewsletterForm` counts as empty (no mailing list).
  - Generation: the prompt bans typed slugs, empty `<Image>`s, typed contact details, newsletter sections and
    invented claims; `studio/lint.ts` sends any it finds back for repair, keeping a compiled section if it never
    gets clean.
  - Studio preview `?catalog=empty` shows the site as a new store goes live; `?catalog=live` over the store's own.
  - The built-in About figures ("10+ years, 1000+ customers") are the flagship's: other stores show none until they
    set their own; the site agent rewrites the flagship's default Why us / Benefits / trust tiles for each store.
- **Claude required:** site generation runs only when the AI gateway answers and Anthropic serves the store
  (`siteAiAvailable` in `lib/site/ai-status.ts`, built on `activeTextProvider`; kept 60 s when up, 15 s when down).
  - The gateway reports Claude "configured" even when its sign-in fails, then answers from Ollama without an error.
    So every studio call checks who answered: anything but `anthropic` throws `StudioAiDownError` (`studio/ai.ts`),
    marks AI down for 5 minutes (`noteSiteAiDown`) and stops the build, keeping finished pages. The AI's fallbacks
    (`.catch(orNull)`) let that error through.
  - Studio GET returns `ai.available` (`?fresh=1`, the "Check again" button, makes one tiny call that counts only when
    Claude answers).
  - The AI routes (start, answer help/finish, directions generate/new, generate, regenerate-page, tweak) answer 503
    `ai_unavailable`.
  - The wizard then says AI generation isn't available, disables "Design it with AI" and selects "I'll design it
    myself", with a "Check again" button. An owner who already has pages keeps the preview, without the AI actions.
  - The admin "Build my whole site with AI" card shows the same notice.
  - `build_site` skips the brief-only build with that reason. Installing a studio site needs no AI.

## 5. Ownership while the parts are built in parallel
| Part | Owns |
|---|---|
| A. Code engine | `lib/site/code/**` (minus `parts/product|listing|cart|checkout|chrome`), `lib/site/data/**`, `components/visitor/site/code/**` (minus the same parts), the `code_section` registration in `lib/site/blocks.ts`, render hooks in `ContentBlocks.tsx` and `home/SectionRenderer.tsx`, validator tests |
| B. Product + listing parts | `lib/site/code/parts/{product,listing}.tsx`, `components/visitor/site/code/parts/{product,listing}/**`, refactors of the product and listing page components they wrap, `storefront-service` product/listing pages |
| C. Cart + checkout + chrome parts | `lib/site/code/parts/{cart,checkout,chrome}.tsx`, `components/visitor/site/code/parts/{cart,checkout,chrome}/**`, refactors of cart/checkout/header/footer components, `storefront-service` cart/checkout pages |
| D. Pipeline + install | `lib/site/studio/**`, `admin-service/src/app/api/(internal)/cron/site-build/route.ts`, `lib/site/onboarding-build.ts` |
| E. Studio UI + storage + gift + install | `controller-service/**` studio files, control-plane table, `controller-service/src/lib/provisioning/steps.ts` (`build_site`), the onboarding wizard |
| F. Non-engaging theming | `packages/site-blocks/src/theme.ts`, the shared visitor UI primitives, and the account/orders/transactions/profile/auth/legal pages' styling |
| A also owns | `lib/site/store.ts` (only the `recompileCodeSections` call in `saveDraftPage`) |
| Coordinator | package.json/package-lock.json, docs, the Site Builder editor (code section inspector, later), integration, final checks |

No one edits package.json. The packages needed are already installed locally: `@babel/parser`, `tailwindcss` 3,
`postcss` and `typescript`. The coordinator adds them as runtime dependencies, because production images install
with `--omit=dev`.
