# Interactive, white-themed ecom landing + live demo

## Goal
Replace the screenshot-driven `/ecom` landing with a professional white (near-black-on-white)
page whose centrepiece is a **live interactive demo**: it auto-plays a full commerce story across
the storefront and admin, and the visitor can take control and click around at any point. Uses
dummy data only, never sends any mail/SMS/API calls.

## Decisions (from the user)
- Interactivity: **auto-play that becomes clickable** (guided flow + free clicking).
- Accent: **near-black on white**, one restrained indigo accent for primary actions/active states.
- Scope: **landing + demo only**; leave pricing/signin/signup/onboard/dashboard/billing as-is.
- No emojis anywhere. Dummy data only; zero network side effects (no mail, SMS, fetch, DB).

## Constraints
- Branch `fix/tenant-forms-host`; no commit/push/branch switch. Edit only ecom-demo files + the
  scoped theme. Do not touch tenant storefront/admin theme, or any `/api` route.
- Files under 500 lines. Match existing code style. Run `graphify update .` at the end.
- The new white look is **scoped to the demo/landing** via a wrapper class, so it never leaks into
  the app's global theme (mirrors how `.light-scope` already scopes the preview pages).

## Architecture
A self-contained demo package under `src/app/ecom/demo/`:
- `theme.ts` / a scoped CSS class `ecom-clean` — the white/near-black tokens + one indigo accent.
- `store.ts` — a tiny client state machine (React context + reducer): the demo's world (products,
  cart, one order, its lifecycle, admin metrics) and a `step` cursor. Pure in-memory, no effects.
- `script.ts` — the ordered list of guided steps (chapters): each step describes what changes in
  the world and which surface is in focus. Auto-play advances the cursor on a timer; any user
  click switches to manual and pauses auto-play.
- `data.ts` — dummy catalogue, customers, one hero order, metrics. Store-neutral (no hardware).
- Surfaces (each a component rendering from `store`): `StorefrontSurface`, `AdminSurface`
  (dashboard + orders + the order detail with a Ship action), shown inside a device/browser frame.
- `DemoStage.tsx` — the orchestrator: frame, chapter rail, play/pause/scrub, focus handling,
  animated transitions between storefront and admin.
- Motion: add `motion` (Framer Motion v13.4.6 — user approved a new lib; dry-run resolves clean
  against React 18.3 / npm 11.5.1, no ERESOLVE/edgesOut). Used only inside `demo/` for surface
  transitions, the order handoff, counters and the tracking timeline; wrapped by a
  `prefers-reduced-motion` guard that falls back to instant state changes. `lucide-react` + `clsx`
  (already present) for icons/classnames.

## The guided flow (chapters)
1. Storefront: browse catalogue, open a product, add to cart.
2. Checkout: fill dummy details, "Pay" (fake), order confirmed with a number.
3. Handoff animation: the new order flies from storefront into the admin.
4. Admin dashboard: revenue counter ticks up, order count +1, live activity row appears.
5. Admin orders: the new order sits at top as "pending", visitor/auto marks it "processing".
6. Fulfilment: create shipment (fake AWB), status -> "shipped", a tracking timeline animates.
7. Invoice: a GST invoice card composes itself.
8. Loop / "explore freely" call-to-action.
Every chapter is both auto-played and directly clickable (e.g. the Ship button works on click).

## Landing rebuild (`page.tsx`)
- White base, thin grey borders, near-black type, indigo only on primary CTA + active states.
- Hero headline + subcopy + CTAs, then the DemoStage as the hero centrepiece (not a screenshot).
- Keep the sections' rhythm (trust bar, feature highlights, mobile, integrations, metrics,
  pricing, final CTA) but feature highlights now scroll the demo to the matching chapter instead
  of showing a static image. More shapes/components (bento, tiles, animated counters).
- Reuse `listPlans()` for pricing. Reuse/restyle `Shapes.tsx` (retint decorative shapes to the
  clean palette). `BrowserFrame` reused for the demo frame (its dots stay; caption is dynamic).

## Workflow (parallel agents)
- **0. install (main, before fan-out)**: `npm install motion` and verify `npm ci` still resolves;
  confirm the lockfile change is only `motion` + its deps.
- **A. theme + tokens**: `ecom-clean` scoped class in globals.css (guarded, does not alter global
  tokens), `demo/theme.ts` constants. Deliver the exact class names other agents use.
- **B. demo engine**: `demo/store.ts`, `demo/script.ts`, `demo/data.ts`, play/scrub controls,
  reduced-motion. No UI beyond the provider + hooks.
- **C. storefront surface**: `demo/StorefrontSurface.tsx` driven by the store (browse->cart->pay),
  adapted from the existing `preview/storefront` look but interactive and white-themed.
- **D. admin surface**: `demo/AdminSurface.tsx` (dashboard metrics + orders table + order detail
  with working Ship/track/invoice), driven by the store, adapted from preview/orders + dashboard.
- **E. stage + landing**: `demo/DemoStage.tsx` and the rewritten `page.tsx` tying it together.
Then a **review** pass (no emojis, no network effects, a11y/reduced-motion, <500 lines, white-theme
consistency, TS) and a **typecheck + fix** pass. Contracts (store shape, hook names, theme class)
are fixed in this plan so agents build against them in parallel.

## Guardrails checked by review
- No `fetch`/mailer/SMS/DB anywhere in `demo/`. No emojis. Files < 500 lines.
- The white theme is scoped; global app theme + tenant storefront/admin unchanged.
- Works at phone width; `prefers-reduced-motion` disables auto-advance/animation.
- `npx tsc --noEmit` clean; the demo renders with JS on and degrades to a static first frame with
  JS off (SSR the first chapter).

## Out of scope (flagged, not built)
- Restyling pricing/signin/signup/onboard/dashboard/billing (later pass).
- Removing the old `/screenshots/*.png` and `preview/*` pages (leave until the new page is signed
  off; the preview pages may still be linked elsewhere).
