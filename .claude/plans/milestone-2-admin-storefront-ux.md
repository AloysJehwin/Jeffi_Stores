# Milestone 2 — v1.4 Admin and storefront UX

Branch: `fix/tenant-forms-host` (stacked on the 43 unpushed structure-refactor commits, per owner). Commit locally each step; never push without an explicit ask. No emojis. Files under 500 lines.

8 issues. Grouped by how much design judgment they need, because 5 of 8 are taste calls where building without direction risks the wrong result.

## Anchor points (verified in code)

- Toast: `src/contexts/ToastContext.tsx` — 69 files already consume it; ~124 files still show inline status.
- Theme: `src/contexts/ThemeContext.tsx`, `src/components/ThemeToggle.tsx`, tokens in `src/app/globals.css` (55 var/theme lines). Pre-hydration theme script ALREADY EXISTS at `src/app/layout.tsx:86` (toggles `.dark` from session/localStorage before paint).
- Product cards: TWO — `src/components/visitor/ProductCard.tsx` and `src/components/business/ProductCard.tsx`; props via `src/lib/catalog/product-card-props.ts`.
- Homepage: `src/components/visitor/HeroCarousel.tsx`, data in `src/lib/catalog/homepage-data.ts` / `homepage-extras.ts` / `hero-slides.ts`.
- Order confirmation: `src/app/(storefront)/account/orders/confirmation/page.tsx` (already renders `OrderAffirmation`, an on-device component).
- Admin mobile: `src/components/admin/AdminMobileNav.tsx` (197 lines), `MobileCard.tsx` (20 lines).

## Tier A — clear-cut, low design-guesswork (safe to automate, verifiable)

### #494 fix(ui): dark theme flashes light on load
NOT a missing script — one already exists at layout.tsx:86. The flash means either (a) the script reads the wrong key/order (it checks `sessionStorage` then `localStorage` for `jeffi-theme`, but ThemeContext may write a different key/value), or (b) CSS/tokens paint a light default before `.dark` is toggled, or (c) `suppressHydrationWarning` missing on `<html>`. Approach: reproduce, diff the script's key/logic against ThemeContext's actual storage key and values, ensure `<html>` default matches the resolved theme, add `color-scheme` meta. Verify: no light frame on hard reload in dark mode (manual, both themes). Risk: low. NEEDS: nothing.

### #498 fix(admin/mobile): finance page tabs overflow the viewport
Finance page tab row overflows on narrow screens. Approach: make the tab strip horizontally scrollable / wrap, within the existing admin mobile pattern. Scope to the finance page tabs only. Verify: no horizontal page scroll at 360–414px; all tabs reachable. Risk: low. NEEDS: nothing.

### #495 refactor(ui): route inline status messages through the unified toast service
~124 files with inline `setError/setMessage/<p class=text-red>` vs 69 on toast. LARGE. Do NOT sweep all 124 blind — many inline messages are intentional inline validation (field-level errors that should stay next to the field), NOT toasts. Approach: define the rule first (transient action results -> toast; persistent field/validation errors -> stay inline), then convert in small batches by surface (admin settings, then checkout, then storefront forms), one commit per surface, keeping field-level validation inline. Verify: each converted flow still shows its message; tests green. Risk: medium (behaviour-visible). NEEDS: owner confirms the toast-vs-inline rule.

## Tier B — measurable but broad

### #493 fix(admin): dark theme contrast refactor
Systematic WCAG contrast fix across admin dark mode. Measurable (contrast ratios) but touches many components. Approach: audit dark-mode token pairs in globals.css against WCAG AA (4.5:1 text, 3:1 UI), fix the TOKENS not per-component overrides so it cascades, then spot-fix components that hardcode colors. Verify: contrast checker on the main admin surfaces. Risk: medium (visual regression if a token shift is too aggressive). NEEDS: owner sign-off on any token whose brand color changes noticeably.

## Tier C — design/taste calls (need direction BEFORE code)

### #496 feat(storefront): order-placed celebration + micro-animations
On the confirmation page. Open questions: confetti vs checkmark draw vs subtle scale-in? Sound? One-shot on first view only (guard with a flag) or every visit? Reduced-motion respect (must). NEEDS: owner picks the style; I default to a tasteful checkmark-draw + fade-in, one-shot, reduced-motion-safe, no sound, if no answer.

### #497 feat(storefront): quick-add on product cards with variant + selling-unit picker
Both ProductCards. Open questions: inline popover on the card vs a bottom-sheet on mobile? What when the product has variants/selling-units — mini picker in the popover vs redirect to PDP? Optimistic add + toast (ties to #495)? NEEDS: owner picks the interaction; big enough to do visitor card first, then business.

### #504 feat(storefront): more engaging, animated homepage components
Vague by nature. Open questions: which sections (hero already has a carousel) — add scroll-reveal, category tiles, featured strip, testimonials? Motion budget? NEEDS: owner names the sections/look, or I propose 2-3 concrete additions first for a pick.

### #499 feat(admin/mobile): unified list/view/popup mobile pattern, starting with products
LARGEST. A reusable mobile pattern (list -> tap -> detail view -> action popup) applied first to products, then spread. Approach: design the pattern as one shared set of components (extend MobileCard), prove it on products/list + products/detail, get owner sign-off on that ONE screen, THEN roll to other admin screens one at a time. NEEDS: owner review of the products screen before any rollout. Do NOT auto-spread to all admin screens.

## Sequencing
1. Tier A first (#494, #498, then #495 in surface batches) — verifiable, low taste.
2. #493 (Tier B) — token audit.
3. Tier C only after owner gives direction per issue (or accepts the stated defaults). #499 proven on products first, sign-off, then rollout.
All local commits. `graphify update` after code changes. Full suite before any eventual push.

## Open decisions needed from owner
- #495: the toast-vs-inline rule (transient->toast, field validation->inline?).
- #493: any brand-color token that would shift visibly.
- #496: celebration style + one-shot vs always.
- #497: quick-add interaction (popover vs bottom-sheet; variant handling).
- #504: which homepage sections and how much motion.
- #499: sign-off on the products mobile screen before rollout.
