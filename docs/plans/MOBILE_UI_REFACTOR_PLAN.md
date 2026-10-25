# Mobile app UI refactor: one design system for every screen

Status: all phases in review (2026-10-25): 0 #580, skeletons #582, 1 #583, 2 #586, 3 #587, 4 #588, 5 #590. Device and TalkBack passes still to do. Scope: the Expo app in `mobile-service/client`. Supersedes the
*visual* rules of `docs/MOBILE_PARITY_PLAN.md` (data and behaviour parity with the storefront still hold).

## Why

The app has two visual languages. Most screens mirror the storefront's mobile web markup (rounded-lg inputs,
web-style buttons, `TopNav` on every screen). The newer screens use the app's own language, which the user approved
on 2026-10-25: rounded-2xl fields and buttons, chunky headings, spring sheets, press feedback (sign-in, quick add,
date picker, animated home sections). The bottom tab bar is gone (PR #578); the top bar is now the hub.

An audit on 2026-10-25 (32 screens) found:

- **Duplicated primitives.** Three button styles plus inline accent buttons in about 24 files; 21 files with raw
  `TextInput`; two address forms; about ten private chip, checkbox and radio variants; three `Pulse` skeletons plus
  four local `Skeleton()`s; no Card, EmptyState or ErrorState primitive. `src/components/ui/Button.tsx` and
  `account/AccountHeader.tsx` are dead code.
- **Five icon systems.** lucide (30 files), `HeroIcon` (20), two near-identical `Glyph.tsx` files, `catalog/icons.tsx`,
  and inline SVGs in about 15 components.
- **No typography system.** No custom font is loaded (the `fontFamily` and `fonts` entries are unused), page titles use
  six different styles, and there are 46 uses of `text-[10px]` and 4 of `text-[9px]`.
- **19 React Native `Modal`s** against 2 users of the app's `BottomSheet`; 9 `Alert.alert` calls.
- **No back header.** Every stack screen shows the brand `TopNav` (logo, search, menu), so deep pages rely on the
  system back gesture.
- **Safe areas** were handled per screen and often missed (fixed in PR #578 for the screens found).
- **Accessibility.** 92 `accessibilityLabel`s for 345 touchables; unlabelled icon-only close buttons; filter chips
  about 24px tall.
- **Motion.** Reduced motion is ignored in the hero carousel, deal timer, pulses, OTP boxes and the 12 `entering`
  animations; the legacy RN `Animated` API is still used in `TopNav` and the pulses.
- **Long lists** (wishlist, cart lines, order items, rewards and referrals) are `ScrollView` + `.map`.
- **Theme.** The theme choice isn't persisted, and with no navigation theme a white flash is possible in dark mode.
- **Bug.** The home error state says "Pull down to try again" but has no `RefreshControl`.

## Decisions

1. **The app's own language wins.** The palette still comes from `packages/design-tokens` and there are still no hex
   literals, but components no longer copy web markup. `MOBILE_PARITY_PLAN.md` keeps its data/behaviour rules and
   gets a banner pointing here for visuals.
2. **One component library** in `src/ui/`, exported from `src/ui/index.ts`. Screens import only from there. Old
   primitives are deleted when their last call site moves; each phase lists the counts it must bring to zero.
3. **Incremental, screen group by screen group.** Logic, API calls and navigation params don't change in a UI PR. A
   behaviour change is its own PR.
4. **One icon set: lucide-react-native.** Brand marks (Google, payment logos) stay as SVG assets.
5. **Every screen renders through `Screen`**, which owns the safe areas, header, background, keyboard handling,
   pull-to-refresh and the loading, empty and error slots. Per-screen inset bugs then cannot recur.

## The design system (phase 0)

**Tokens and theme**

| Area | Plan |
|---|---|
| Radius | Field and button 16, card 20, sheet 28, chip full. App aliases in `client/tailwind.config.js` (`rounded-field`, `rounded-card`, `rounded-sheet`), so the shared `radius` tokens the web uses don't change. |
| Elevation | `src/ui/elevation.ts` with three levels (raised, overlay, floating). No shadow in dark mode; a border instead. Replaces 23 inline `boxShadow` strings and 9 `SHADOW_*` constants. |
| Spacing | 16 gutter, a 4-point scale, section gap 24. |
| Colour | Semantic classes only, as today. Status tones move into `src/ui/tones.ts` (from `ORDER_STATUS_TONE`, SupportChat's badge and `lib/badge.ts`). |
| Theme | Persist the choice (system, light or dark) with AsyncStorage. Set the expo-router `ThemeProvider` and `Stack contentStyle` background from the tokens, and drive `StatusBar` style from the theme. |

**Typography**
- Load Inter (400/500/600/700/800) for text and Plus Jakarta Sans (700/800) for display copy, through the
  `expo-font` config plugin (`android.fonts`) so weights map natively.
- Text components:

  | Component | Size and weight |
  |---|---|
  | `Display` (Plus Jakarta Sans) | 30/800 |
  | `Title` (page, Plus Jakarta Sans) | 24/800 |
  | `Heading` (section) | 18/700 |
  | `Subheading` | 16/600 |
  | `Body` | 15/400 |
  | `BodySmall` | 13/400 |
  | `Caption` | 12/500 |
  | `Overline` | 11/800 uppercase |

- Nothing below 11px. The six page-title styles collapse into `Title`.

**Primitives** (each replaces the listed variants)

| Component | Replaces | Notes |
|---|---|---|
| `Button` (primary, secondary, outline, ghost, destructive; sizes md 48, lg 56) | `PrimaryButton`, `BigButton`, `ui/Button`, inline accent buttons | press scale, loading, optional haptic |
| `IconButton` | TopNav's private one, ad-hoc close buttons | 44px minimum, `label` required by type |
| `TextField` | `ui.Input`, AuthScreen `Frame`, 21 raw `TextInput` files | label, prefix/suffix, helper, error, focus ring; built on the auth `Frame` look |
| `PhoneField`, `OtpField`, `DateField` | `PhoneInput`, `OtpBoxes`, `DobInput` | `DateField` exists (`ui/DatePickerSheet.tsx`) |
| `SelectField` | `ui.Select` (inline dropdown) | opens a sheet list |
| `Chip`, `ChipGroup` | `FilterChip`, FilterSheet `Chip`, `pdp/OptionChips`, `cart/Chips`, `ChannelChips`, `ModeChip` | 36px min height |
| `Checkbox`, `Radio`, `Switch` | `ui.Checkbox`, `checkout/Radio`, FilterSheet `Box`/`RadioRow`, FrequentlyBoughtTogether's | |
| `Card`, `ListRow`, `Divider` | inline `bg-surface-elevated` containers (rounded-lg 75, xl 45, 2xl 13) | `ListRow`: icon, title, subtitle, trailing, chevron |
| `Badge`, `Pill` | `StatusPill`, `SaleRibbon` ×2, `WarningBadges` ×2, `StockBadge`, `statusChip` | tones from `tones.ts` |
| `Skeleton` (Reanimated, reduced-motion aware) | 3 `Pulse`s, 4 local `Skeleton()`s, `ProductGridSkeleton` | |
| `Spinner` | `ui/Spinner`, raw `ActivityIndicator` in 22 files, `RingSpinner` | |
| `EmptyState`, `ErrorState` (with retry) | `catalog/Paged` `EmptyCard`, wishlist's, inline ones, `ErrorBox`, ad-hoc error text | |
| `Sheet` (root host) and `ModalSheet` (hosted in a `Modal`, as `DatePickerSheet` does) | 19 `Modal`s used as sheets or dialogs | |
| `ConfirmSheet` | 9 `Alert.alert` calls | |
| `Toast` | (kept) | already consistent |

**Screen scaffolding**
- `Screen`: background, `ScreenHeader` or `TopNav`, safe-area bottom padding, `scroll` / `keyboard` / `list` modes
  (`KeyboardScroll`, `FlatList`), optional pull-to-refresh, and `loading` / `empty` / `error` slots.
- `ScreenHeader` for stack screens: back button, title, up to two actions, large-title variant for top-level pages.
  `TopNav` (brand, search, cart, account, menu) stays on home, products, cart and wishlist only.
- `Section`: heading, optional "See all", gutter. The home `SectionHeading` becomes this.

Phase 0 ships the library with a hidden `/dev/ui` gallery route (dev builds only) that renders every component in
light and dark, used for screenshot review before any screen migrates.

## Skeleton loading (requested 2026-10-25)

Every screen that waits on data shows a skeleton shaped like the content it is about to show, never a bare
spinner and never a blank screen. An audit on 2026-10-25 found 9 routes on a full-screen spinner and the rest on
three different hand-rolled pulses (`account/ui` `Pulse`, `catalog/Paged` `Pulse`, `cart/Pulse`).

**Primitive (phase 0).** `Skeleton` in `src/ui` is a `bg-surface-secondary` block with a shimmer band swept across it.
One shared clock drives every block, so a page shimmers as one; it runs only while a skeleton is mounted and stays still
with reduced motion on. Blocks hide from screen readers; the screen's loading state carries the label.

**Rules**
- The skeleton matches the real layout's sizes (card heights, image ratios, gutters), so nothing jumps when data lands.
- Shown only on the first load. A refetch keeps the old content (pull to refresh shows its own spinner).
- Spinners stay for actions in progress (a button that's saving, the payment hand-off), not for content.
- Sub-sections that load on their own (reviews, related products, tracking) get their own small skeleton in place.

**Building blocks** (`src/ui/skeletons.tsx`): `ProductCardSkeleton`, `ProductGridSkeleton` (columns follow the real
grid), `ProductRailSkeleton`, `ListRowSkeleton`, `OrderCardSkeleton`, `CartLineSkeleton`, `ArticleSkeleton`,
`FormSkeleton`, `TileGridSkeleton`, and page compositions built from them.

| Screen | Today | Skeleton |
|---|---|---|
| Home | spinner | hero card, category row, two product rails |
| All products, category, brand, wishlist | spinner / pulse grid | chip row + product grid |
| Categories, brands | pulse | tile grid |
| Product page | spinner | gallery, title and price, option chips, action bar |
| Quick add sheet | pulse | header row, price, chips, button |
| Cart | pulse | three cart lines + summary card |
| Checkout review | spinner + pulses | address card, items, totals |
| Order confirmation | pulse | status hero, items, totals |
| Orders | pulse | order cards |
| Order detail | spinner + pulses | status header, items, tracking, totals |
| Order tracking (inline) | spinner | timeline rows |
| Addresses | pulse | address cards |
| Rewards, referrals, quotes, subscriptions, transactions | pulse | header card + list rows |
| Delete account | spinner | notice card + rows |
| Compare | pulse | two-column table |
| Legal index / policy | spinner | list rows / article |
| Product reviews (PDP) | blank | rating summary + review rows |
| Search panel (TopNav) | spinner | result rows |

The skeleton pass ships right after phase 0, before the screen-by-screen migration, as its own PR.

## Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| 0. Foundations | `src/ui/` library, tokens and elevation, fonts (native), `expo-updates` (native), theme persistence and navigation theme, `/dev/ui` gallery | Gallery reviewed in light and dark at 360dp and 412dp, font scale 1.0 and 1.3; an OTA update reaches a release build |
| 1. Shell and navigation | `Screen` + `ScreenHeader` on all 32 routes; drawer redesigned as a sheet menu built from `ListRow`s; TopNav cleanup (Reanimated, `IconButton`); home error state gets pull-to-refresh | Every stack screen has a back header; no screen sets its own bottom inset |
| 2. Commerce core | Home sections, products and category listing, `ProductCard` (one ribbon/pill), PDP (`Glyph` to lucide, `Chip`s, sticky bar), cart, checkout review, payment, confirmation, `QuickAddSheet` | Zero `PrimaryButton`/`BigButton`/raw `TextInput` in these screens |
| 3. Account and orders | Account hub as `ListRow`s, orders list, order detail (split the 1,126-line file into sections), one `AddressSheet` replacing both address modals, profile, rewards, referrals, subscriptions, quotes, transactions, delete account, review and tracking sheets | Both address modals deleted; zero `Modal` imports in `account/` |
| 4. Remaining screens | Auth screens onto the shared primitives (they set the look), support chat, compare, categories, brands, info, legal | Dead code removed: `ui/Button.tsx` (old), `AccountHeader`, both `Glyph.tsx`, `catalog/icons.tsx`, `HeroIcon` |
| 5. Quality pass | Accessibility (labels, roles and states on every touchable; 44px targets; TalkBack pass on home, PDP, cart and checkout); a `useMotion()` helper so every autoplay, pulse and `entering` animation honours reduced motion; long lists to `FlatList` (wishlist, cart lines, order items, rewards, referrals, subscriptions); `recyclingKey` on images in lists; dark-mode gaps (`CouponHintBanner`, `info/about`, SupportChat tints) | Label coverage on touchables near 100%; no `ScrollView`+`map` over unbounded data |

Each phase is one or more PRs grouped by screen. Phase 0 needs one native build (fonts and `expo-updates`).

**Over-the-air updates (EAS Update).**
- Phase 0 adds `expo-updates` with a fingerprint runtime version, so an update only reaches builds with matching
  native code.
- The main-merge pipeline checks the fingerprint:
  - unchanged native code → `eas update --branch production`, which reaches phones within minutes, no Play review;
  - changed native code → the existing EAS build and Play submit.
- Phases 1 to 5 are JavaScript only, so they ship over the air.
- Rollback is republishing the previous update.

## Rules for every PR

- Import UI only from `src/ui`; no new private primitive. If a component is missing, add it to `src/ui` first.
- No hex, no inline `boxShadow`, no `text-[Npx]` below 11, no `Alert.alert`, no React Native `Modal` outside
  `src/ui`.
- Logic and API calls unchanged; screenshots before/after in the PR (light and dark, 360dp, the three-button nav bar).
- Run the CI check set (root `tsc`, lint, unit and integration tests, build) and the app typecheck.

## Verification

- Every phase: on a device or emulator, with both the three-button nav bar and gesture navigation, at 360dp width,
  font scale 1.3, light and dark, plus reduced motion on.
- Phase 5: a TalkBack walk through browse → product → add to cart → checkout.
- Keep a short changelog per phase in this file (what moved, what was deleted, counts).

## Decisions (2026-10-25)

- **Fonts:** Inter for text, Plus Jakarta Sans for titles and hero copy.
- **Over-the-air updates:** yes, EAS Update from phase 0.
- **Account entry:** a person button in the top bar, between cart and menu (shipped with PR #578).

## Open decisions

1. **Header on top-level pages.** Keep the brand `TopNav` on home, products, cart and wishlist, or use a large-title
   `ScreenHeader` there too and keep the brand only on home.
