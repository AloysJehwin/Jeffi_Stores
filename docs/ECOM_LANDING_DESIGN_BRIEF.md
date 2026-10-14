# Ecom Landing Page — Design Brief

**Target:** `controller-service/src/app/(ecom)/ecom/` (served at `ecom.jeffistores.in`).

## 1. Page composition (render order)

Layout wraps everything in `.ecom-scope min-h-screen bg-surface flex flex-col`:
- `<EcomNav owner={...} />` — fixed top, 56px
- `<EcomMain>` — flex-1, adds `pt-14` offset

Landing page root: `<div class="ecom-clean bg-[#eef1f5] text-foreground relative isolate">`

| # | Section | Component | Notes |
|---|---------|-----------|-------|
| 1 | Hero | inline h1/p/CTA + `<DemoStage />` | h1 is 2-line, second line in accent blue |
| 2 | Trust bar | 4-tile grid | Storefront+Admin · Online+COD · Delhivery · GST-ready |
| 3 | How it works | `<HowItWorks />` | 3-step row with connector line |
| 4 | Apps grid | `<AppsGrid />` | Grouped lucide-icon cards from `apps.ts` |
| 5 | Feature grid | `<FeatureGrid />` | 9 feature tiles, 3-col |
| 6 | The whole loop | `<LandingFeatures />` | 6 clickable chapter cards; scrubs the demo |
| 7 | Mobile bento | inline 4-cell grid | 3× `<PhoneMock>` + orange CTA tile; `Gear`/`Coin`/`TrendUp`/`Dots` as `opacity-10` background art |
| 8 | FAQ | `<Faq />` | 7 accordion items, first open |
| 9 | Integrations | inline text logos | Razorpay · Delhivery · GST/GSTN · Google · AWS |
| 10 | Metrics band | dark `bg-foreground text-surface` | 4 stat tiles |
| 11 | Final CTA | inline centered | "Your store is one step away" + Get started free |

## 2. Component tree with props

### EcomNav
```ts
{ owner: { email: string; name: string | null } | null }
```
Fixed top-0 inset-x-0 z-40, h-14, `bg-surface-elevated/80 backdrop-blur`. Self-hides on signin/signup routes.
- Brand mark: `J` in `w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500 to-accent-500 text-white` + wordmark `Jeffi Commerce`
- Links: `Pricing`, then conditional `Dashboard`/`Sign out` or `Sign in`/`Get started`

### DemoStage
```ts
{ initialChapter?: number }
```
Mock browser (Chrome traffic lights + address bar). Height clamp: `h-[68svh] min-h-[420px] sm:h-[calc(82svh-2.25rem)] sm:min-h-[484px] max-h-[864px]`. Overlays: Play/Pause button, FlowTabs row, Stepper row. Listens for `window.CustomEvent('ecom-demo-goto')` dispatched by LandingFeatures to scrub.

### BrowserFrame
```ts
{ src?: string; alt: string; caption: string; className?: string; children?: ReactNode }
```
`rounded-xl overflow-hidden border border-border-default bg-surface-elevated shadow-2xl`. 36px chrome strip with three colored dots + mono caption. Body shows children, image (16:9), or placeholder.

### Shapes
- `PhoneMock({ variant?: 'store' | 'chart' | 'card'; src?; alt?; className? })` — `rounded-[2rem] border-[6px] border-foreground/80 bg-surface-elevated shadow-2xl`, `w-[190px]`, aspect 9:19 (or 390:844 with src). Three variants render tiny product tiles / 7-bar chart `[40,65,50,80,60,90,70]%` / gradient card + list.
- `Gear`, `Coin`, `TrendUp` — stroke SVGs
- `Dots` — 5×5 circle grid, 60×60 viewBox

### HowItWorks
No props. 3 steps, numbered `h-14 w-14 rounded-full` badges, `h-px` connector line, lucide `UserPlus / Settings2 / Rocket`.

### AppsGrid
No props. Groups → `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`, card = `rounded-2xl border border-border-default bg-surface p-5`. 30 lucide icons available via `ICONS` map.

### FeatureGrid
No props. 9 cards in `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4`. Icons: `ShoppingBag, LayoutDashboard, CreditCard, Truck, FileText, Boxes, Users, Megaphone, Building2`.

### LandingFeatures
No props. 6 cards; each dispatches `scrub(chapter)` → `CustomEvent('ecom-demo-goto')` + scrolls to `#demo-stage`.

### Faq
No props. State `const [open, setOpen] = useState<number | null>(0)`. `mx-auto max-w-3xl space-y-3`, chevron rotates on open.

## 3. Demo animation story

**6 flows / 20 chapters** driven by `chapters.ts`. Each chapter has a storefront or admin surface and a `focus` key that swaps the inner view.

| Flow | Chapters | Surfaces |
|------|----------|----------|
| Customer buys | browse → product → cart → pay | storefront: catalogue/product/cart/checkout |
| Store owner fulfils | dashboard → order → ship → docs | admin: dashboard/order/shipment/docs |
| Inventory & catalogue | inventory → po → grn | admin: inventory/po/grn |
| Payments, GST & finance | settlement → gstinvoice → reports | admin: settlement/gstinvoice/reports |
| Returns & B2B | return → quote → rfq | admin: return/quote/rfq |
| Marketing & CRM | campaign → coupon → crm | admin: campaign/coupon/crm |

**Animation layering:**
- `SurfaceFade` wraps surface swaps — horizontal 24px slide + opacity, 0.3s, `mode="wait"`
- `View` wraps focus blocks — vertical 10px slide + opacity, 0.3s
- `FlowTabs` uses shared `layoutId="ecom-flow-underline"` for the sliding underline
- Stepper connectors animate width 0 → 100% on completed steps
- Dashboard bars animate height with `i * 0.02s` stagger
- `CountUp` cubic-ease (900ms) for Revenue/Orders/AOV/Customers
- All gated by `prefers-reduced-motion`

## 4. Structural primitives

**Typography scale:** `font-extrabold` / `font-black` / `font-bold`, `tracking-tight`, `tabular-nums`, `font-mono` (BrowserFrame caption + badges only).
- Hero h1: `text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.05]`
- Section heads: `text-4xl lg:text-5xl font-extrabold`
- Final CTA: `text-5xl lg:text-6xl font-extrabold`

**Decorative art** (bento section only, hidden on mobile):
- `Gear` at `-left-6 top-16 w-24 h-24`
- `Coin` at `right-16 top-24 w-16 h-16`
- `TrendUp` at `right-1/3 bottom-10 w-20 h-20`
- `Dots` at `right-8 bottom-16 w-28 h-28`

**Container widths:** `w-full px-6 lg:px-12`. Section vertical rhythm: `py-16` / `py-20` / `py-24`.

## 5. Copy manifest (flat, by section)

### Nav
`Jeffi Commerce` · `Pricing` · `Sign in` · `Get started` · (signed in) `Dashboard` · `Sign out`

### Hero
H1: **Sell anything.** / **We run the store.** _(second line in brand accent)_
Sub: `A complete online store on your own subdomain — storefront, admin, payments, delivery and GST, managed for you.`
CTA: `Start your store` → `/signup`

### Trust bar
- `Storefront + Admin` / `one platform`
- `Online + COD` / `payments built in`
- `Delhivery` / `delivery & tracking`
- `GST-ready` / `invoicing`

### How it works
Eyebrow: `How it works` · Heading: `Live in three steps`
1. **Sign up** — Create your account in minutes — no card, no setup fee.
2. **We set up your store** — Your own subdomain with storefront and admin, plus payments, delivery and GST configured for you.
3. **Start selling** — Add your products, hit publish and go live to customers.

### Apps grid
Eyebrow: `Every app, one login` · Heading: `One platform, every tool your store needs`
Sub: `Catalogue, sales, fulfilment, finance, marketing and B2B — all built in, all working together.`
(Per-group titles + per-app name/blurb come from `apps.ts`.)

### Feature grid (9 cards)
Eyebrow: `Everything included` · Heading: `No add-ons, no surprises` · Sub: `Every capability below ships on day one.`
1. **Storefront** — A fast, mobile-first catalogue on your own subdomain.
2. **One admin** — Run the whole business from a single dashboard.
3. **Payments (online + COD)** — Captured to settled, reconciled for you.
4. **Delhivery delivery** — Create shipments and track live AWBs.
5. **GST invoicing** — CGST/SGST/IGST invoices, GSTR-ready.
6. **Inventory** — Stock levels, low-stock alerts, batches and serials.
7. **CRM** — Customer health, segments and lifetime value.
8. **Campaigns** — Triggered email and WhatsApp journeys.
9. **B2B portal** — Approve business accounts with GST and pricing.

### The whole loop (LandingFeatures, 6 cards)
Eyebrow: `The whole loop` · Heading: `One platform, end to end` · Sub: `Tap a step to jump straight to it in the demo above.`
- **Storefront** — A fast catalogue your customers enjoy browsing.
- **Payments** — One-tap checkout with online and COD built in.
- **Dashboard** — Sales land instantly as revenue you can see.
- **Delivery** — Generate shipments and track a live AWB.
- **GST invoices** — Compliant invoices, done in a single click.
- **Insights** — Revenue, orders and trends at a glance.
Each ends with: `See it in the demo`

### Mobile bento
Eyebrow: `Built for mobile commerce` · Heading: `Your store, in every pocket`
- Store phone: **A storefront that sells itself** — Fast, mobile-first shopping — catalogue, search, cart and checkout tuned for conversion on any device.
- Orange CTA: **Rs. 0** — setup cost · go live today
- Card phone: **Payments, settled for you** — Online & COD split automatically.
- Chart phone: **Insights on the go** — Revenue, orders and stock at a glance — manage the whole business from your phone.

### FAQ (7 items)
Eyebrow: `Questions` · Heading: `Frequently asked questions`
1. **Do I get my own domain?** — Every store launches on its own subdomain, ready to use straight away. You can also connect a custom domain you already own on the higher plans.
2. **How does pricing work?** — We offer plans from Basic to Enterprise, so you can start small and move up as you grow. Every plan includes the storefront and admin — you only step up for more capacity and advanced features.
3. **Which payment methods are supported?** — Online payments run through Razorpay — cards, UPI, netbanking and wallets — and Cash on Delivery is built in. Both are settled and reconciled for you automatically.
4. **Are the invoices GST compliant?** — Yes. Orders generate GST-ready invoices with your details filled in, so your billing stays compliant without any manual work.
5. **How is delivery handled?** — Delivery is powered by Delhivery. You can generate shipments from the admin and share live tracking with your customers end to end.
6. **Can I move my existing catalogue over?** — Yes. You can bring your existing products across in bulk and pick up where you left off, rather than rebuilding your catalogue from scratch.
7. **What support do I get?** — You get support throughout — from the initial setup of your store to help whenever you have a question while running your business.

### Integrations
Lead: `Powered by the tools you trust`
`Razorpay` · `Delhivery` · `GST / GSTN` · `Google` · `AWS`

### Metrics band (dark)
- `Minutes` / `to go live`
- `100%` / `storefront on every plan`
- `Online + COD` / `payments handled`
- `GST-ready` / `invoicing`

### Final CTA
Heading: **Your store is one step away**
Sub: `Set it up in minutes. Start selling today.`
Button: `Get started free` → `/signup`

### Demo stage copy (visible while scrubbing)
- Address bars: `novastore.jeffistores.in` / `admin - {chapter title}`
- Flow tabs: `Customer buys` · `Store owner fulfils` · `Inventory & catalogue` · `Payments, GST & finance` · `Returns & B2B` · `Marketing & CRM`
- Storefront chrome: `Nova Shop`, `Search products`, `Featured products`, `Add to cart`, `Checkout`, `Pay {total}`, `Order confirmed`, address `14 Marina Ave, Chennai 600001`
- Admin chrome: eyebrow `Store admin`, metrics `Revenue / Orders / AOV / Customers / Gross margin`, chips `1 order pending > 24h`, `{n} low / out of stock`, `1 open return`, buttons `Mark processing / Create shipment / Generate docs / Send campaign / Create coupon`, footnotes `Demo only. No real email or SMS is sent.`

### Chapter blurbs (demo, verbatim)
- Browse the store — A fast, clean catalogue your customers enjoy.
- Open a product — Rich pages with ratings, offers and instant add-to-cart.
- Add to cart — A friction-free cart that keeps shoppers moving.
- Checkout and pay — Online or COD, with a checkout buyers trust.
- The order lands — The sale shows on your dashboard the moment it is paid.
- Confirm the order — Confirm and prepare the order from one screen.
- Ship and track — Create a Delhivery shipment and watch it move.
- Slip and label — A GST packing slip and shipping label, generated for you.
- Watch your stock — Live stock levels with low-stock and out-of-stock alerts.
- Reorder from a supplier — Raise a purchase order when stock runs low.
- Receive the goods — Receive against the PO and stock climbs back up.
- Money settles — Every payment captured, then settled to your account.
- GST invoice — A compliant tax invoice with CGST and SGST, automatic.
- The numbers — Receivables, ageing and GST returns in one place.
- Handle a return — Approve, receive and refund a return without the mess.
- Quote a buyer — Build a GST quotation and send it in a click.
- Close a B2B deal — Negotiate an RFQ and convert it to an order.
- Launch a campaign — Reach the right buyers with an email campaign.
- Create a coupon — Spin up a code and watch redemptions roll in.
- Know your customers — A built-in CRM: who buys, how often and what they love.
