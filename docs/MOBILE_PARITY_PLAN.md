# Mobile app ↔ storefront parity

The Play Store app (`mobile-service/client`) must look and behave like the storefront's mobile web view
(`controller-service/src/app/(storefront)`, components in `src/components/visitor`). Every storefront change
that affects the mobile viewport lands here too, in the same PR.

## Ground rules

- **One palette.** `packages/design-tokens` is the only place a brand colour, radius or font is defined. The web
  (`tailwind.config.ts` → `:root`/`.dark` via `addBase`) and the app (`client/tailwind.config.js`, `src/theme.ts`)
  both read it. No hex literals in app screens: use the semantic classes (`bg-surface`, `bg-surface-elevated`,
  `text-foreground`, `text-foreground-muted`, `border-border-default`, `bg-accent-500`, `text-primary-500`).
- **Same data.** The app talks only to `mobile.jeffistores.in`; storefront JSON comes from the same `/api/*`
  routes the web calls, so a field added on the web is available to the app without server work.
- **Same component inventory.** Each web component in the list below has one RN counterpart under
  `client/src/components/<area>/`, named the same. When a web component changes, its counterpart is updated in
  the same PR (CI type-checks both; the Play release job ships the client when it changed).
- Light scheme is the default, dark follows the system, matching the web's `ThemeProvider`.

## Phases

| # | Scope | Web source | App target | Status |
|---|---|---|---|---|
| 0 | Shared tokens, semantic classes, Metro/Tailwind wiring | `globals.css`, `tailwind.config.ts` | `tailwind.config.js`, `src/theme.ts`, `metro.config.js` | done 2026-10-20 |
| 1 | Shell: header (logo, search, cart badge, drawer), bottom tabs, drawer menu | `visitor/Header.tsx`, `MobileDrawer.tsx` | `components/layout/TopNav`, `(tabs)/_layout` | next |
| 2 | Home: hero carousel (Top Picks), perks strip, offer slider, Shop by Category, Featured Products, brands row, New Arrivals, Explore categories with product tiles | `HeroCarousel`, `OfferSlider`, `FeaturedProducts`, `FeaturedForYou`, `(storefront)/page.tsx` | `(tabs)/index.tsx` + `components/home/*` | |
| 3 | ProductCard: discount badge, SALE ribbon, brand/category lines, "From ₹", strike price, "Inclusive of all taxes", stock + "View Details →", "Deliver by", round add/wishlist buttons | `visitor/ProductCard.tsx`, `QuickAddButton` | `components/product/ProductCard.tsx` | |
| 4 | Product list + categories: search bar, Filters sheet, pagination, category tiles with tag chips | `ProductGrid`, `FilterSidebar`/`MobileFilterSheet`, `ListPagination`, `categories/page` | `(tabs)/products`, `categories/*`, `category/[slug]` | |
| 5 | PDP: breadcrumb, gallery + thumbs, SALE ribbon, variant chips, price block (you save, incl. taxes), qty stepper with min/max, Buy Now / Add to Cart, bank offers strip, perks grid, pincode check, specifications, compare strip, description, sticky bottom bar | `ProductDetailClient`, `ProductImageGallery`, `ProductActions`, `PdpCompareSection` | `product/[slug].tsx` + `components/pdp/*` | |
| 6 | Cart, wishlist, compare | `(storefront)/cart`, `wishlist`, `CompareBar` | `(tabs)/cart`, `(tabs)/wishlist` | |
| 7 | Auth + account: email OTP sign-in, Google, account home, orders, addresses, transactions, referrals/rewards | `(storefront)/account/*`, `AccountMobileHeader`, `AccountSidebar` | `(auth)/*`, `account/*`, `orders/*` | |
| 8 | Checkout: review, payment (Razorpay from server key, COD), order placed | `(storefront)/checkout` | `checkout/*` | |
| 9 | Business (B2B) storefront: business price badge, quotation request | `components/business/*` | `components/business/*` | |

## Verification per phase

- Side-by-side screenshots: web at 390×844 (`scratchpad/pw/scroll.mjs`) vs `adb exec-out screencap` on the Samsung.
- `npm --prefix mobile-service/client run typecheck` and the dev client on the phone (`adb reverse 8081/3103`).
- No new hex literal in `client/app` or `client/src` (grep `#[0-9a-f]{6}` stays at zero).
