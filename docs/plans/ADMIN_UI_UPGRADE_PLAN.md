# Admin UI upgrade: one design language for every page

Status: phase 0 (kit) and phase 1 (Brands pilot) done 2026-10-17; kit API not frozen until the light/dark 1440/390 screenshot review. Companion to `PAGE_OVERVIEWS_PLAN.md` (which put an Overview tab on most areas) and `MAIN_DASHBOARD_PLAN.md`. That work moved the *overview* tabs onto a shared kit. This plan moves everything else (lists, view, create and edit pages, consoles, settings) onto the same language.

Reference implementation: `financial/_components/AiCostsTab.tsx`, `financial/_components/OverviewCharts.tsx` (`KeyedTrendCard`, `MixDonutCard`, `ChartCard`), `components/admin/overview/kit.tsx`, `components/admin/channels/ui.tsx`, `components/ui/Select.tsx`, `components/ui/DatePicker.tsx`.

## Constraints (from the user, 2026-10-17)

- **Application-native UI.** Everything uses our own admin components and tokens (the AI costs tab look), so every page feels like one app. No third-party UI kits, no native browser controls, no one-off styling.
- **Existing logic must not break.** Waves change markup and layout only: server actions, API calls, scopes, write gates, drafts, URL params and validations stay as they are. Any behaviour change is a separate, explicit task.
- **One control height: 32px.** Every input, select, search box, date picker, button, icon button and segmented chip bar (period presets, filter chips) is exactly the height of the tab-line action button ("Add New Product"): 32px, via `h-control` / `.field-md` / `.control-md` (the `sm` tier is the same height with tighter padding; `xs` 26px stays only for controls inside table cells). Chips inside a segmented bar fill the bar's 32px. Never set control height with padding (`py-*`).
- **Status messages are toasts.** Every success, info, warning and error response from an action (save, sync, refresh, connect, delete, send, import) shows as a toast via `contexts/ToastContext.tsx`, not an inline banner or status strip. Inline messages stay only for persistent state that is not a response (a field validation error under its input, a "needs reconnect" connection state, an empty or error state that replaces the content).
- **Mobile.** View, lists and overviews are fully usable on mobile. Create and edit stay desktop only, except orders and common actions (status, confirm, ship, cancel, refund, notes, scan, stock adjust, approvals, replies).

## 1. Where things stand

Audit of all 138 `page.tsx` files under `app/(admin)/admin` (about 40 are redirect-only aliases such as `brands/[id]` to `brands/[id]/view`, `edit/[id]` to `[id]/edit`, `mailer/*`, `loyalty`, `referrals`, `merchant-sync`; they need no work).

What is already good:
- Native controls are essentially gone: no `<select>` or `type="date"` remain except two `<select>` in `ecom/ai-pricing` (a redirect target whose client still ships). `Select`/`AdminSelect`/`DatePicker` are used everywhere else.
- Every area with an Overview tab uses `PeriodBar`, `Kpi`/`KpiGrid`, `AttentionList`, `Section` and channel `Tabs`/`TabLinks` (about 21 `*Tabs.tsx` wrappers, all on the shared `Tabs`).
- Confirmations go through `useConfirm` (`contexts/ConfirmContext`), toasts through `ToastContext`, write gating through `useCanWrite`.
- Channel consoles (merchant, amazon, amazon-ads, meta-ads, google-ads, traffic, social-posts) and the ecom platform overviews are already built on `channels/ui`.

What is not:
- **Two visual systems.** Overview tabs use the kit; the list, view and form pages below them still use the older stack: page-level `<h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">` (50 pages, plus about 50 other heading variants), `AdminFilters` + `AdvancedFilterPanel` + `SortableHeader` + `Pagination` + `ResponsiveList` for lists, and hand-built `<table>` markup on view pages.
- **Hard-coded palette.** About 450 `gray-*`/`slate-*`/`bg-white` classes and about 2,500 `dark:` overrides, concentrated in `orders/[id]/view` (109 `dark:`, 23 hard-coded), `customers/[id]/view` (67), `inventory` (106), `products`, `invoices`, `scan` (69 hard-coded), `campaigns/scenarios` (40), `review-forms` (42), `login` (26). The kit uses semantic tokens (`bg-surface-elevated`, `border-border-default`, `text-foreground-muted`) and needs almost no `dark:`.
- **No view-page shell.** Each `[id]/view` page assembles its own header, back link, status chips, action buttons, info grid and line-item table. None use `Kpi`, `Section` or `Table`.
- **No form layout kit.** `ProductForm` (6,047 lines), `LineItemsSection` (1,800), `CouponForm`, `ReviewFormForm`, `CategoryForm`, `BrandForm`, supplier and PO forms each style their own labels, inputs (about 270 raw `<input>` across the admin), section headings and submit rows. `components/admin/site-controls/controls.tsx` (`SectionCard`, `TextControl`, `ToggleControl`, `SelectControl`) is the closest thing to a standard and only Site Controls uses it.
- **Forms are blocked on mobile.** 19 create/edit pages wrap themselves in `MobileEditBlock` ("Editing is not available on mobile").
- **Ad-hoc dialogs.** 58 files hand-roll `fixed inset-0` overlays; there are two local `Modal` components (`financial/_components/shared.tsx`, `google-ads/_components/wizard/fields.tsx`).
- **Three chart families.** `financial/_components/OverviewCharts.tsx` (the reference), `components/admin/dashboard/Charts.tsx` + `Primitives.tsx` + `StatCard.tsx` (main dashboard), and one-off SVG charts in `business/rfqs`, `inventory`, `products/[id]/analytics`, `crm`.

## 2. Design rules

These are what the AI costs tab does, written down so every page can follow them.

**Page anatomy (top to bottom)**
1. Page header: title, one-line description, optional status badges. No page-level primary buttons below the title.
2. Tab line (`TabStrip`/`Tabs`/`TabLinks`): Overview first where the area has one. Page actions (New, Export, Import, Settings) sit at the right end of the tab line as `TabAction` icon buttons (label shown from `sm` up). Pages without tabs put the same actions in the header's action slot.
3. Context bar: `PeriodBar` for anything time-based, search and filters for lists. Period lives in `?from&to`, filters in the query string, so every view is linkable.
4. Error `Banner`, then content. Loading shows a skeleton of the final layout, never a spinner on a blank page.
5. Content order: KPI grid, then needs-attention, then charts, then tables or detail sections.

**KPI cards.** `Kpi` in a `KpiGrid` (2 / 3 / 6 columns). Uppercase muted label, bold tabular value, delta vs the previous period with an arrow and green/red tone, `invert` when lower is better (costs, failures, returns), `sub` for the context line, `highlight` for the one headline figure. Values formatted with `money`, `count`, `pct`; never raw numbers. A metric that does not apply shows `-` with a `sub` saying why, rather than disappearing.

**Attention lists.** `AttentionList` with critical/warning/info severity, each item linking to where you act. Empty state is a green "nothing needs attention" line, not a hidden card. Conditional warnings that need a sentence (for example an unpaid wallet) use `Banner`.

**Charts.** Always inside a card with a title and an optional hint (`ChartCard`). Trend over time spans two columns of an `xl:grid-cols-3` grid with a mix/donut card beside it. Charts own their empty state ("No data in this range."), hover tooltip, IST bucket labels and fixed series colours from one palette map per dimension.

**Tables.** `Section` card with an uppercase title and an optional action at the right; `Table` with typed `Col<T>` definitions: numbers right-aligned and tabular, sortable headers, a written empty message ("No AI usage in this period."), client paging at 25 rows. IDs and references in `font-mono text-xs`. Status in `Badge` with a tone (red, amber, green, blue, muted), never coloured text. Tables scroll horizontally inside their card; the page never does.

**Spacing and surfaces.** `space-y-5` between page blocks, `gap-3` in KPI grids, `gap-4` between cards. Cards are `bg-surface-elevated border border-border-default rounded-xl`, padding `p-4` (KPIs, charts) or `p-5` (sections). Page padding `p-4 sm:p-6`.

**Typography.** Page title `text-2xl font-bold text-foreground` (drop `text-secondary-500 dark:text-foreground`). Section titles `text-sm font-semibold uppercase tracking-wide`. Labels `text-xs text-foreground-muted`. Body `text-sm`. Numbers `tabular-nums`.

**Colour and dark mode.** Semantic tokens only (`surface-*`, `border-*`, `foreground*`, `accent-500`). Status colours come from `Badge`/`Banner`/`Kpi` tones, which already carry their dark variants. A new `dark:` class in a page is a smell; a new `gray-*`, `slate-*` or `bg-white` is a bug.

**Actions.** Primary page actions on the tab line or header (icon plus label). Row actions in a trailing row menu (`RowActions`), destructive ones last and confirmed with `useConfirm`. Every write control respects `useCanWrite` and is disabled, not hidden, when the admin lacks write scope, so the page layout does not shift between roles.

**Forms.** One column of `FormSection` cards (title, short description, fields), two-column field grid from `md`. Labels above inputs, hint below, error in red below the hint. `Select`/`MultiSelect`, `DatePicker`/`DateTimePicker`, `Toggle` and the shared `inputCls`; no per-file input classes. A sticky footer holds Cancel and Save, shows dirty state, and on create pages "Save as draft" where drafts exist. Server actions stay as they are; only the markup around them changes.

**Mobile.** Lists render cards (`MobileListCard`, `MobileDetailSheet`, `MobileActionSheet`). KPI grids fall to two columns, charts keep a 320 px minimum and scroll. Tab lines scroll with edge fades (already in `TabStrip`). Create and edit stay **desktop only**: `MobileEditBlock` is kept on every create/edit page (and added where a new one is missing). The exceptions that must work on a phone are orders and the common day-to-day actions: order status changes, confirm, ship, cancel, refund, notes, packing/scan, stock adjust, task updates, reply to reviews and messages, approve/reject. Those use `Sheet` and compact forms at 390 px.

## 3. Missing building blocks

Proposed home: `components/admin/kit/`, with `channels/ui.tsx` and `overview/kit.tsx` re-exported from it so no existing import breaks.

| Block | Proposed API | Replaces |
|---|---|---|
| `PageHeader` | `{ title; description?; back?: { href; label }; badges?: ReactNode; actions?: ReactNode; meta?: ReactNode }` | about 100 hand-built `<h1>` blocks and breadcrumb rows |
| `EntityPage` | `{ header: ReactNode; kpis?: ReactNode; attention?: AttentionItem[]; main: ReactNode; aside?: ReactNode; tabs?: ReactNode }`; lays out `xl:grid-cols-3` with `main` spanning two | every `[id]/view` layout |
| `DetailHeader` | `{ title; subtitle?; status?: { label; tone }; identifiers?: { label; value; copy? }[]; primary?: Action; secondary?: Action[]; overflow?: Action[] }` where `Action = { label; icon; href? \| onClick?; danger?; confirm?: string; scope?: string }` | the action button rows on order, invoice, quotation, RFQ, product views |
| `Fields` / `Field` | `<Fields cols={2 \| 3}>` of `<Field label value hint? copy? mono?/>`; renders `-` for empty | the key-value grids on every view page |
| `FormPage` | `{ header; children; footer: ReactNode; onDirtyChange? }` with `beforeunload` guard | ad-hoc create/edit wrappers (keeps `MobileEditBlock` on mobile) |
| `FormSection` | `{ title; description?; children; aside?; collapsible?; id? }` (anchor-able, used for a section nav on long forms) | `CollapsibleSection`, `site-controls` `SectionCard`, ad-hoc `<h3>` blocks in `ProductForm` |
| `FormField` | `{ label; htmlFor; hint?; error?; required?; span?: 1 \| 2; children }` plus thin `TextInput`, `TextArea`, `NumberInput`, `MoneyInput` (Rs prefix, paise-safe) using `inputCls` | per-file label and input classes; `site-controls` `TextControl` etc. become wrappers over it |
| `FormFooter` | `{ submitLabel; pending; dirty; onCancel; secondary?: ReactNode; autosave?: AutosaveState }`, sticky at the bottom | submit rows; `AutosaveStatusPill` folds in |
| `DataTable` | Superset of `Table`: `{ rows; cols: Col<T>[]; rowKey; mode: 'client' \| 'server'; total?; page?; sort?; onSort?; search?; filters?: FilterDef[]; savedViews?: { storageKey }; selectable?; bulkActions?: Action[]; rowActions?: (r) => Action[]; mobileCard?: (r) => ReactNode; loading?; error?; empty?: EmptyStateProps }`. Server mode reads and writes `?q&sort&dir&page&f.*` so list pages stay server-rendered. Saved views start in `localStorage` | `SortableHeader` + `Pagination` + `ResponsiveList` + `AdminFilters` + `AdvancedFilterPanel` stacks; hand tables |
| `LineItemsTable` | `DataTable` preset for invoice, quotation, PO, order lines with a totals footer | the table half of `LineItemsSection` and view-page line tables |
| `Dialog`, `ConfirmDialog`, `Sheet` | `Dialog { open; onClose; title; description?; size?: 'sm' \| 'md' \| 'lg'; footer?; children }` with focus trap, Esc, scroll lock; `ConfirmDialog` becomes the renderer behind `useConfirm` (API unchanged); `Sheet` is the mobile bottom sheet (`MobileDetailSheet` folds in) | 58 `fixed inset-0` overlays and the two local `Modal`s |
| `EmptyState`, `ErrorState` | `{ icon?; title; body?; action?: Action }` | `Empty`, ad-hoc "No results found." boxes |
| Skeletons | `ListSkeleton`, `DetailSkeleton`, `FormSkeleton` shaped like the real layout; `AdminSkeleton` variants map onto them | spinners, generic grey boxes |
| `ChartCard` + charts | Promote `ChartCard`, `KeyedTrendCard`, `MixDonutCard`, `RankedBars` from `financial/_components/OverviewCharts.tsx` to `components/admin/kit/charts.tsx`; merge `dashboard/Charts.tsx` `TrendChart` into the same API | three chart families |
| `StatusBadge` | `{ status; map: Record<string, { label; tone }> }` with shared maps for order, payment, shipment, invoice, quotation | `statusBadgeClass` in dashboard `Primitives`, per-page colour maps |

Each block ships with a small unit test (render, empty, loading, dark token classes) under `tests/components/admin/kit/`.

## 4. Page-by-page

Gap codes: **H** legacy header; **P** hard-coded palette or heavy `dark:` overrides; **L** legacy list stack (filters, sortable header, pagination, responsive list); **T** hand-built tables; **F** ad-hoc form layout and inputs; **M** blocked on mobile (`MobileEditBlock`); **D** hand-rolled modal; **V** no view shell (header, fields, KPIs); **C** one-off chart; **K** already on the kit, polish only.

Size: S under half a day, M about a day, L several days. Priority: 1 daily-use pages, 2 regular, 3 occasional or platform-only. "Flux" means another agent is editing it now; audit reflects its current state and it should be scheduled after that work lands.

### Overview and auth

| Route | Type | Gaps | Size | Pri |
|---|---|---|---|---|
| `dashboard` | overview | own `dashboard/Primitives`, `StatCard`, `Charts` (second design language), P | L | 1 |
| `login` | auth | P (26 hard-coded), D; outside the shell | S | 3 |

### Orders and fulfilment

| Route | Type | Gaps | Size | Pri |
|---|---|---|---|---|
| `orders` | list | H, L, P | M | 1 |
| `orders/[id]/view` | view | V, P (worst in the app: 109 `dark:`, 23 hard-coded), 17 hand action buttons in `_components` | L | 1 |
| `returns`, `replacements` | list | client lists below the overview tab use ad-hoc cards; P light | M each | 2 |
| `delhivery` | console | T (3 tables), H | M | 2 |
| `packing-slips` | list | T, P light | S | 2 |
| `labels` | tool | F (raw inputs), H | S | 3 |
| `scan` | tool | P (69 hard-coded in `ScanClient`), D | M | 2 |
| `cash-sale` | list + POS | tabs done; T, D, sortable header | M | 2 |
| `cash-sale/[id]/view` | view | V, T | S | 2 |
| `subscriptions` | list | L, P (12 hard-coded) | M | 2 |
| `subscriptions/[id]/view` | view | V, P (12 hard-coded), T | M | 2 |

### Catalogue

| Route | Type | Gaps | Size | Pri |
|---|---|---|---|---|
| `products` | list | L (`ProductsTableClient`), P, 4 modals in `_components` | L | 1 |
| `products/add`, `products/[id]/edit` | create, edit | `ProductForm` 6,047 lines: F, M, D (3), 17 select sites, no section nav | L (own track) | 1 |
| `products/[id]/view` | view | `ProductDetailClient` 1,742 lines: V, T | L | 1 |
| `products/[id]/analytics` | view | C, D, P light | M | 3 |
| `brands` | list | H, L, T | S | 2 |
| `brands/add`, `brands/[id]/edit` | create, edit | `BrandForm`: F, M | S | 2 |
| `brands/[id]/view` | view | V, T | S | 2 |
| `categories` | list | L, T, D, P (34 `dark:`) | M | 2 |
| `categories/add`, `categories/[id]/edit` | create, edit | `CategoryForm`: F, M | S | 2 |
| `categories/[id]/view` | view | V, T (2) | M | 2 |
| `offers` | list | tabs done; list client ad-hoc | S | 2 |
| `offers/[id]/view` | view | V | S | 2 |
| `catalog-enrichment` | console | T, H | M | 3 |
| `inflation` | tool | T (3), P | M | 3 |
| `controls` | settings console | 1,628 lines, L filters, F, H | L | 3 |
| `shelving` | console | P (43 `dark:`), F | M | 3 |

### Sales documents and B2B

| Route | Type | Gaps | Size | Pri |
|---|---|---|---|---|
| `invoices` | list | tabs done; `InvoicesClient` sortable header, D, P | M | 1 |
| `invoices/[id]/view` | view | `InvoiceDetailClient`: V, T, D, P | L | 1 |
| `quotations` | list | tabs done; sortable header, D (3), F (29 raw inputs in create flow) | M | 1 |
| `quotations/[id]/view` | view | V, T | M | 1 |
| `business/customers` | list | T, P (14 hard-coded) | M | 2 |
| `business/customers/[id]` | view | `BusinessCustomerDetailClient`: V, P | M | 2 |
| `business/rfqs` | list | T, C (`RfqTrendChart`), P | M | 2 |
| `business/rfqs/[id]` | view | `RFQDetailClient` 1,320 lines: V, D (2), F | L | 2 |

### Customers and marketing

| Route | Type | Gaps | Size | Pri |
|---|---|---|---|---|
| `customers` | list | L, P | M | 1 |
| `customers/[id]/view` | view | V, P (67 `dark:`, 6 hard-coded), 11 bespoke cards in `_components` | L | 1 |
| `crm` | overview console | 20 bespoke cards, 9 modals, P (52 `dark:`) | L | 2 |
| `customer-programs` | settings + overview | F (13 raw inputs), T (3), P light | M | 2 |
| `coupons` | list | L, P | M | 2 |
| `coupons/add`, `coupons/[id]/edit` | create, edit | `CouponForm`, user picker: F, M, T | M | 2 |
| `coupons/[id]/view` | view | V, T (2) | M | 2 |
| `campaigns` | list | ad-hoc list, P | S | 2 |
| `campaigns/new` | create | F, M | M | 2 |
| `campaigns/[kind]/view` | view | V | S | 2 |
| `campaigns/[kind]/edit` | edit | 1,162 lines: F, M, T, P (26 hard-coded in folder) | L | 2 |
| `campaigns/scenarios` | list | P (40 hard-coded in folder) | S | 3 |
| `campaigns/scenarios/new`, `campaigns/scenarios/[kind]` | create, edit | F, M, P | M | 3 |
| `marketing/messaging` | list | L, P | M | 2 |
| `marketing/messaging/new` | create | 852 lines: F, M | L | 2 |
| `marketing/messaging/[id]/view` | view | V, T, P | S | 2 |
| `marketing/messaging-templates` | list | ad-hoc list, skeletons only | S | 3 |
| `review-forms` | list | L, T | S | 3 |
| `review-forms/add`, `review-forms/[id]/edit` | create, edit | `ReviewFormForm`: F, M, P (42 hard-coded in folder) | M | 3 |
| `review-forms/[id]/submissions` | list | T, H | S | 3 |
| `reviews` | list | D, P light | M | 2 |
| `social-posts` | console | K; 23 raw inputs in composer, own calendar | M | 3 |

### Channels (already on the kit)

| Route | Type | Gaps | Size | Pri |
|---|---|---|---|---|
| `merchant`, `amazon`, `amazon-ads` | console | K; forms use `inputCls` without `FormField` | S each | 3 |
| `meta-ads` (flux) | console | K; creative dialogs hand-rolled (D) | S | 3 |
| `google-ads` | console + wizard | K for reports; wizard has local `Modal`, 53 raw inputs, 26 `RowActions` | L | 3 |
| `traffic` | overview | K | S | 3 |

### Finance and operations

| Route | Type | Gaps | Size | Pri |
|---|---|---|---|---|
| `financial` | tabs | reference; PL, payables, receivables, cashflow tabs still have local `Modal`, T (8), F | M | 2 |
| `financial/payables/[id]/view` | view | V, T, P | M | 2 |
| `gst` | report | T (7), P | M | 2 |
| `wallet` | console | T (2), H, not on kit | M | 2 |
| `inventory` (flux) | console | 6,849 lines: L (28 sortable headers), T (8), C, P (106 `dark:`) | L | 2 |
| `inventory/po/new` (flux) | create | 1,383 lines: F, M, D, line items | L | 2 |
| `suppliers` (flux) | list | overview on kit; list in inventory | S | 2 |
| `suppliers/new`, `suppliers/[id]/edit` (flux) | create, edit | F (26 inputs on `inputCls`), M | M | 2 |
| `suppliers/[id]` (flux) | view | `SupplierDetailClient`: V | M | 2 |
| `tasks` | list | ad-hoc list, P (32 `dark:`) | M | 2 |
| `data-source` | console | own tab components, F | M | 3 |

### Admin and settings

| Route | Type | Gaps | Size | Pri |
|---|---|---|---|---|
| `team` | list | T, P (31 `dark:`) | M | 3 |
| `audit` | list | 2,097 lines, ad-hoc list, P | M | 3 |
| `service-accounts` | list | T, P, H | S | 3 |
| `service-accounts/add` | create | F, M | S | 3 |
| `settings` | settings | `TwoFactorCard`, `ExtensionTokenCard`, ad-hoc cards, H | S | 3 |
| `settings/site-controls` (flux) | settings | already on `site-controls/controls.tsx`; becomes the `FormSection` reference | S | 3 |
| `settings/homepage` | settings | hero slide manager; keep desktop-only | S | 3 |
| `agent` | console | 1,438 lines, P (17 `dark:`) | M | 3 |
| `agent/logs`, `agent/proposed-tools` | list | ad-hoc lists, H | S each | 3 |

### Platform (ecom, flagship only, flux)

| Route | Type | Gaps | Size | Pri |
|---|---|---|---|---|
| `ecom/customers`, `ecom/billing`, `ecom/instances`, `ecom/store-status` | list | K (via `overview-shell`) | S each | 3 |
| `ecom/customers/[id]/view`, `ecom/billing/[id]/view`, `ecom/instances/[id]/view`, `ecom/store-status/[id]/view` | view | V, T (billing), toggle buttons ad-hoc | S to M | 3 |
| `ecom/ai-pricing` (client still shipped behind a redirect) | settings | 2 native `<select>`, T | S | 3 |

## 5. Phasing

**Phase 0: kit (one agent, 3 to 4 days).** Build `components/admin/kit/*` from section 3, with re-exports from `channels/ui.tsx` and `overview/kit.tsx`, tests, and a short usage section appended to this doc. No page changes beyond the reference tab importing from the new path.

**Phase 1: pilot (one agent, 1 to 2 days).** Brands, end to end: list, view, add, edit. Small, self-contained, has drafts and a server action, so it exercises every block. Review screenshots light and dark at 1440 and 390 px, adjust the kit, then freeze its API.

**Phase 2: waves, parallel agents, each owning separate folders.** Shared files (`components/admin/kit/*`, `ProductForm.tsx`, `LineItemsSection.tsx`) are owned by one named agent per wave; others request changes instead of editing.

| Wave agent | Owns | Notes |
|---|---|---|
| A. Orders and fulfilment | `orders`, `returns`, `replacements`, `delhivery`, `packing-slips`, `labels`, `scan`, `cash-sale`, `subscriptions` | `orders/[id]/view` first; most-used view page |
| B. Catalogue | `products` (list and view), `brands` (done in pilot), `categories`, `offers`, `catalog-enrichment`, `inflation`, `controls`, `shelving` | `ProductForm` is a separate track (B2): UI only, restyled in place with the kit's visual components and a section nav; its logic is not touched; plan it for three or four days |
| C. Sales documents and B2B | `invoices`, `quotations`, `business/*`, `financial`, `gst`, `wallet` | owns `LineItemsSection` and `LineItemsTable` |
| D. Customers and marketing | `customers`, `crm`, `customer-programs`, `coupons`, `campaigns`, `marketing/*`, `review-forms`, `reviews`, `social-posts` | |
| E. Operations and admin | `inventory`, `suppliers`, `tasks`, `team`, `audit`, `service-accounts`, `settings`, `data-source`, `agent` | start only after the current inventory, suppliers and purchase-order work is merged |
| F. Platform, channels, dashboard | `ecom/*`, `merchant`, `amazon*`, `meta-ads`, `google-ads`, `traffic`, `dashboard`, `login` | mostly polish; dashboard chart merge depends on phase 0 charts; ecom and meta-ads after current work lands |

Within each wave the order is priority 1 pages, then view pages (biggest visual win per hour), then create/edit, then the rest.

**Phase 3: clean-up.** Delete `SortableHeader`, `ResponsiveList`, `AdminFilters`, `Pagination`, `CollapsibleSection`, `dashboard/Primitives` and the local `Modal`s once unused. Add a lint test that fails on new `gray-*`/`slate-*`/`bg-white` classes and new `fixed inset-0` overlays under `app/(admin)`.

Rough total: phase 0 and 1 about a week; waves A to F about two weeks with six agents in parallel; clean-up two days.

## 6. Risks

- **Server actions and forms.** Create/edit pages post through server actions (`actions.ts` next to the page) and draft flows (`DraftEditButton`, `DraftConfirmModal`, `DraftRowActions`). Only markup changes; form field `name`s, hidden inputs, `useActionState` wiring and redirect targets must stay identical. `FormFooter` must render a real `type="submit"` inside the form.
- **Scopes and write gates.** Every page keeps its server-side `hasScope`/`isPlatformOwner` checks; `Action.scope` in the new kit is for disabling buttons only, never the gate. `tests/lib/admin-page-scope-coverage.test.ts`, `admin-write-scope-audit.test.ts`, `admin-client-write-gate.test.ts`, `nav-scope-alignment.test.ts` and `platform-only-scopes.test.ts` must pass unchanged; if one keys on a component name or file path being moved, update the test's fixture, not its rule.
- **URL contracts.** List filters, sort and page parameters, `?tab=` values and `?back=` links are bookmarked and used by the main dashboard and attention lists. `DataTable` server mode must accept the existing parameter names; keep the redirect-only alias routes.
- **Tenant paths.** Links go through `ap()` with the host; the kit's `Action.href` must take an already-resolved path and never build `/admin/...` itself.
- **Mobile.** Create/edit stays blocked on mobile (`MobileEditBlock`), except orders and common actions, which get a 390 px pass each.
- **ProductForm.** Largest and riskiest file, and it carries a lot of internal logic (state, validation, drafts, variants, pricing, server actions). Change the UI only: restyle markup and layout in place, do not restructure, split or rewrite its logic. Keep `tests/components/admin/mobile-product-pattern.test.tsx` and product action tests green.
- **Concurrent edits.** Inventory, suppliers, purchase orders, meta-ads, site controls and ecom are being changed now; their waves start from whatever has merged, and agents do not touch folders outside their wave.
- **Print and PDF views.** Invoice, quotation, packing slip and label views have print styles; check print preview after restyling.

## 7. Verification

Per page or per wave:
- `npm run typecheck` and `npm test` (vitest) at the repo root; the scope and write-gate tests listed above.
- Kit component tests under `tests/components/admin/kit/`; new tests for any pure helper moved into the kit (status maps, formatters).
- Manual pass, light and dark, at 1440 px and 390 px: header and actions, loading skeleton (throttle network), empty state (filter to nothing), error banner (force a 500), read-only admin (write controls disabled, layout unchanged), and one real create, edit and delete through the server action.
- A marker report run before and after each wave (the counts in section 1: hard-coded palette classes, `dark:` count, `fixed inset-0`, `SortableHeader`/`ResponsiveList` imports, `MobileEditBlock` uses), with the totals recorded in this doc so progress is visible.
- `graphify update .` after each wave.

## 8. Kit usage (phase 0, 2026-10-17)

Everything imports from `@/components/admin/kit` (barrel) or a module directly. `channels/ui.tsx` and `overview/kit.tsx` are now named re-exports of `kit/core.tsx` and `kit/period.tsx`, so old imports keep working; new code imports from the kit.

| Module | Exports |
|---|---|
| `core.tsx` (client) | `Section`, `Kpi`, `KpiGrid`, `Badge`, `Banner`, `Empty`, `Tabs`, `TabLinks`, `TabStrip`, `TabAction`, `TabActionsHost/Portal`, `Table`/`Col`, `api`, `money`, `count`, `pct`, `change`, `when`, `lastDays`, `RangePresets`, `inputCls`, `btnPrimary`, `btnGhost` |
| `period.tsx` (client) | `usePeriod`, `PeriodBar`, `useOverviewData`, `AttentionList`, `OverviewSkeleton` |
| `tones.ts` | `Tone`, `TONE_CLS`, `badgeCls(tone)` (plain module, usable in server components) |
| `layout.tsx` (server-safe) | `PageHeader {title, description?, back?, badges?, actions?, meta?, media?}`, `PageBody`, `EntityPage {header, tabs?, notices?, kpis?, attention?, main, aside?}`, `Card {title?, hint?, action?, flush?}`, `Fields {cols}`, `Field {label, value, hint?, copy?, mono?, span?}`, `BackLink` |
| `actions.tsx` (client) | `KitAction {label, icon?, href?, onClick?, danger?, confirm?, scope?, disabled?, busy?}`, `ActionButton`, `DetailHeader {title, subtitle?, status?, identifiers?, media?, back?, primary?, secondary?, actions?}`, `CopyValue` |
| `form.tsx` (client) | `FormPage {header?, footer?, onDirtyChange?, guardUnload?}`, `FormSection {title, description?, aside?, id?, collapsible?}`, `FormGrid {cols}`, `FormField {label, htmlFor?, hint?, error?, required?, span?}`, `TextInput`, `NumberInput`, `MoneyInput`, `TextArea`, `FormButton` (type="submit", passes name/value), `FormFooter {submitLabel?, pending?, dirty?, cancelHref?/onCancel?, secondary?, autosave?, children}`, `fieldInputCls` |
| `data-table.tsx` (client) | `DataTable<T> {rows, cols: DataCol<T>[], rowKey, mode, total?, page?, pageSize?, pageHref?, search?, filters?, savedViews?, toolbar?, selectable?, bulkActions?, rowActions?, onRowClick?, mobileCard?, mobile?, loading?, error?, empty?, bare?}`, `DataToolbar {search?, filters?, savedViews?}` (URL-bound, same semantics as `AdminFilters`), `DataCol`, `FilterDef`, `BulkAction` |
| `dialog.tsx` (client) | `Dialog {open, onClose, title, description?, size?, footer?}` (portal, Esc, focus trap, scroll lock), `ConfirmDialog` (renders `useConfirm`/`usePrompt`; their API is unchanged), `Sheet` (mobile bottom sheet) |
| `states.tsx` (server-safe) | `EmptyState {icon?, title, body?, action?, actionNode?, bare?}`, `ErrorState`, `TableSkeleton`, `ListSkeleton`, `DetailSkeleton`, `FormSkeleton` |
| `status.tsx` (server-safe) | `StatusBadge {status, map?, label?}`, maps `ACTIVE_STATUS`, `ORDER_STATUS`, `PAYMENT_STATUS`, `SHIPMENT_STATUS`, `INVOICE_STATUS`, `QUOTATION_STATUS`, `humanize` |
| `charts.tsx` (client) | `ChartCard {title, hint?, action?}`, `TrendLines`, `KeyedTrendCard`, `MixDonutCard`, `RankedBarsCard`, plus `DonutSplit`, `RankedBars`, `TrendChart` re-exported from `dashboard/Charts` (the merge into one trend API is wave F) |
| `toast.ts` (client) | `useActionToast()` returns `{ success, error, info, warning, result(res, { success?, error?, warning? }) }`; `resultToast(res)` picks text and tone. No-op outside a `ToastProvider` |

Rules of use:
- **Server pages cannot pass functions to client components.** `DataTable` columns, `KitAction.onClick` and `rowActions` live in a small client component next to the page (`brands/_components/BrandsTable.tsx`); the page passes rows and plain props. Server-safe pieces (`PageHeader`, `EntityPage`, `Card`, `Fields`, `StatusBadge`, states) take ReactNode slots directly.
- **Keep the toolbar outside the list Suspense.** Render `DataToolbar` in the page and `DataTable` (without `search`/`filters`) inside the keyed Suspense, so the search box stays mounted while the table reloads.
- **Action responses go through `useActionToast`**, not a banner. A minimal migration keeps the old call sites: replace `const [banner, setBanner] = useState(...)` with `const setBanner = useCallback(b => b && toast.result(b), [toast])` and delete the banner markup (done in `google-ads/GoogleAdsClient.tsx`).
- `FormFooter` renders inside the `<form>`; custom intent buttons go in as `FormButton name="intent" value="..."` children.
- `KitAction.scope` disables (never hides) the button; the server gate stays as it is.

### Phase 1 pilot (Brands) notes

Brands list, view, add and edit are on the kit; behaviour unchanged (same queries, params, page links, toggle, delete, drafts, server actions). `BrandTableRow.tsx` was folded into `brands/_components/BrandsTable.tsx` and deleted. Toast conversion: `google-ads/GoogleAdsClient.tsx` (connect, sync, test, disconnect, OAuth return), `google-ads/_components/ManageContext.tsx` (campaign edits) and `merchant/_components/MerchantConsole.tsx` (refresh). Still using inline result banners, for their waves: `amazon/_components/AmazonConsole.tsx`, `amazon-ads/_components/AmazonAdsConsole.tsx`, `meta-ads/_components/MetaAdsConsole.tsx`, `social-posts` (`SocialPostsClient`, `Composer`, `Insights`), google-ads `AudiencesView`, `AlertsPanel`, `ConnectPanel` (invite notice), `ConversionsView`, and the `CampaignWizard` result panel; also `data-source` tabs and `components/admin/site-controls/ProvidersCard.tsx`.
