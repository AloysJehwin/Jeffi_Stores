# Admin layout standard

- Status: proposed
- Date: 2026-10-17
- Scope: every admin area under `controller-service/src/app/(admin)/admin/*`, every form/view component under `controller-service/src/components/admin/*`, and the admin shell.
- Driver: the product edit page stacks three bars with inconsistent widths, radii and backgrounds (orange banner, tab bar with its own actions, and a second amber "auto-saved draft" banner). The same misalignments repeat across brands, coupons, suppliers, categories, review forms, messaging and more. This plan fixes it once for the kit and then rolls it out per service.

The kit already exists (`controller-service/src/components/admin/kit/*`): `PageHeader`, `PageBody`, `EntityPage`, `FormPage`, `FormSection`, `FormField`, `FormFooter`, `Tabs`/`TabStrip`/`TabActionsHost`, `Banner`, `Card`, `Kpi`/`KpiGrid`. The problem is not that it is missing pieces — it is that pages still inline banners and toolbars with their own radii, paddings and backgrounds instead of using the kit. The standard below is written so a page can be audited by reading its top 100 lines.

## 1. Standard page frame

Container, in order:

1. Admin shell (`components/admin/AdminShell.tsx`) — provides the scrollable `<main>`. Pages never touch the shell inset or set their own max-width.
2. `PageBody` (or `FormPage`, same wrapper) — the only element that controls page padding. Padding is `p-4 sm:p-6` and inter-block spacing is `space-y-5`. No page may add extra margin/padding on its first child.
3. `PageHeader` — title + description + back link + optional badges + actions.
4. Page-level notices — persistent state banners only (draft pending, pending approval, needs reconnect). Not action responses.
5. Tab bar — `Tabs` or `TabLinks`, with the edit-session toolbar in the `actions` slot (same line as tabs).
6. Tab-level notices — only when the notice is specific to the active tab.
7. Tab content — `Card` or `FormSection` blocks, each full-width.

Edge rule: every full-width block above (header, notice, tab bar, card, footer) shares the same horizontal edge as the body. No wrapper may add a horizontal background, border or extra padding that breaks that line. In particular, drop the lingering `rounded-xl` wrappers around banners, orange hero stripes above tabs and ad-hoc `px-4` on individual notices — the shared `PageBody` padding is the only inset.

Max width: none. The admin shell's `<main>` is the content area; pages fill it. If a form becomes awkward at wide screens, constrain inside a card, never on the page.

Vertical rhythm (fixed): `PageBody` uses `space-y-5` for top-level blocks (20px). `FormSection` and `Card` internal fields use `space-y-4`. `FormGrid` gap is `gap-4`. KPI grid gap is `gap-3`. Tabs sit directly under the header; no notice between them unless it is page-level persistent state.

Backgrounds: the shell is `bg-surface-secondary`. Only `Card`/`FormSection`/`FormFooter`/`Kpi` use `bg-surface-elevated`. Banners use the tinted intent background (see `Banner`), not elevated surface. Nothing else draws a background.

Radii: `rounded-xl` for every card, banner, footer, KPI tile. `rounded-lg` only for inline controls (buttons, inputs, chips, pills). A banner that still uses `rounded-lg` is a bug.

Controls: every clickable or input control is 32px (`h-control` / `control-md` / `field-md`). Icon-only buttons use the same 32px square. No ad-hoc `py-2`+`px-4` buttons on pages.

## 2. Draft / edit-session UX

Today a draft-backed edit page can show two banners stacked:

- an outer "Edits are saved to draft. The live product stays unchanged until you publish." (`src/app/(admin)/admin/products/[id]/edit/page.tsx:211`), and
- an inner "You have an auto-saved draft. Click Restore to load it, or Discard to clear it and reload from database." (`src/components/admin/ProductForm.tsx:3419`).

Those are two separate concepts (server-side draft row vs browser localStorage autosave), but the user sees two overlapping warnings. Standard: **one banner at a time**, with three mutually exclusive states.

Single component: `DraftNotice` (new, in `components/admin/kit/`). Props: `mode: 'live' | 'draft' | 'draft-with-local'`, `onRestore`, `onDiscard`. Rendered by `FormPage` when a `draft` prop is passed, so no page assembles its own banner.

States and copy:

| State | When | Copy | Actions |
| --- | --- | --- | --- |
| `live` | Not editing a draft. | (no banner) | — |
| `draft` | Editing a server draft; no local autosave to restore. | "Editing a draft. The live record is unchanged until you publish." | — |
| `draft-with-local` | Editing a server draft and a newer local autosave exists. | "A newer local autosave exists for this draft." | Restore, Discard |

Visuals: amber tone (`Banner` with a new `tone="draft"`, which maps to amber), `rounded-xl`, matches card edges. Icon left. Right-aligned Restore/Discard are text buttons (`text-accent-500 font-semibold`, `h-control` so they align with the banner's text baseline).

Edit-session toolbar: lives in the `Tabs` `actions` slot via `TabActionsPortal` so it sits on the tab line, right-aligned, 32px, same height as the tabs. The toolbar renders:

- autosave pill (`AutosaveStatusPill`),
- `Draft` chip (`Badge tone="amber"`) when the session is unpublished,
- `Cancel edit session` button (ghost, 32px, text + icon on sm+, icon-only on mobile).

Rules:

- The toolbar is the only place the edit-session Cancel appears on the tab line. Pages must not add a second "Discard draft" link in the header; use `FormFooter.secondary` instead.
- No sticky container around the tab bar unless the sticky behaviour is intentional for that page. If it is sticky, the sticky wrapper must share the body padding, so the edges still line up with the cards below.

Sticky bottom footer: `FormFooter`, as it already is. Required slots:

- left: `AutosaveStatusPill`, "Unsaved changes" marker, optional `secondary` (e.g. Discard draft).
- right: Cancel link → extra draft submit buttons → primary Publish/Save.
- Primary button label: "Publish" for draft-backed forms, "Save" for direct forms. Pending label is `"<verb>-ing…"`.

## 3. Form page standard

- Use `FormPage` as the top wrapper (never a bare `<form>` plus `<div>`). It handles dirty tracking and `beforeunload`.
- Use `FormSection` for every card. Section titles are uppercase, tracking-wide, 13px (`text-sm font-semibold uppercase tracking-wide`), with an optional one-line description underneath.
- No collapsible sections (`collapsible` prop removed from new pages; the ProductForm already dropped them in commit 65128137). Long forms split by tabs instead.
- Grid: `FormGrid cols={2}`. Fields are `col-span-1` by default, `span={2}` for full width, `span={3}` for cols-3 grids. Single-column at `<md`. Keep the same `cols` across sections of one tab.
- `FormField` is the only way to render label/control/hint/error. Required marker: red asterisk after the label. Hints go underneath the control, errors in red below the hint.
- Every control is 32px (`fieldInputCls`). `AdminSelect`, `DatePicker`, `HoverCard`'s trigger button, text/number/money/textarea inputs all use the same classes already.
- Tab error badge: when a tab has invalid fields, the tab label shows a red count pill (`<span className="text-xs text-red-500">(n)</span>`). On submit the form switches to the first failing tab (already in ProductForm — move to `FormPage` via a `tabErrors` prop).
- Save-draft and Publish intents are expressed by hidden `name="_intent"` inputs on the submit buttons inside `FormFooter`, not by two separate forms.

## 4. List page standard

- `PageBody` → `PageHeader` (title, description, actions on the right) → optional `KpiGrid` → `DataToolbar` → optional `AdvancedFilterPanel` (`Card`, same edges, open under the toolbar) → `DataTable` (sideways scroll, never overlapping text) → `InfiniteFooter` with "Showing X of Y".
- The toolbar is one row at desktop. Search input left, filter selects filling the middle (equal flex so gaps are even), Advanced toggle on the right, primary "New …" action after it. Primary action always right-most.
- Attribute/advanced filters panel is a card under the toolbar, not a drawer — matches the pattern that landed in commit 0af71a15 for products.
- Row actions: top-right icon buttons (per the user memo `icon-action-standardization-todo.md`). No per-row kebab until that's ratified; keep icon buttons until then.

## 5. Detail / view page standard

- `EntityPage` with `header`, optional `tabs`, `notices` (persistent only), optional `kpis`, `main` and optional `aside`.
- `main` columns span 2 of 3 at `xl`, `aside` spans 1. Below `xl` they stack.
- Content is `Card`+`Fields`+`Field`. Prefer `Fields cols={2}`.
- Status chips use `Badge` with a tone from `tones.ts`.

## 6. Dialogs, sheets, toasts, states

- Dialog: `kit/dialog.tsx`. Max width `max-w-lg` for simple, `max-w-2xl` for complex. Footer right-aligned with Cancel then primary.
- Toast: `useToast()` for action responses — success, warning, error. Persistent state uses a banner, not a toast. One `useActionToast()` wrapper per server action is the convention.
- Empty state: `kit/states.tsx` `Empty`. Centered text, muted, 32px CTA where it makes sense.
- Error state: red tone banner, same radii.
- Skeleton: `AdminSkeleton` / `AdminTableSkeleton`. Skeleton rows match the real control heights (32px).

## 7. Dark mode and tokens

- Only token classes. No raw hex colors in pages. The approved pairs are already encoded as `bg-surface`, `bg-surface-elevated`, `bg-surface-secondary`, `text-foreground`, `text-foreground-secondary`, `text-foreground-muted`, `border-border-default`, `border-border-secondary`, `accent-500`/`accent-600`.
- Status/tint tones live in `tones.ts` (`green`, `amber`, `red`, `blue`, `muted`). Add a `draft` alias on top of `amber` to make draft intent explicit; everything else keeps today's names.
- Banner background is tinted at `/5`, border at `/40`, icon at the solid color — no page should pick different opacities.

## 8. Alignment acceptance checks

A page is standard if, with no account for the sidebar or topbar:

1. The left edge of the title, every notice, the tab bar, every card and the footer is one vertical line.
2. The right edge is the same vertical line on all of the above.
3. There is exactly one `PageBody`/`FormPage` wrapper and nothing else sets `px-*` on the page.
4. The tab bar's actions sit on the same line as the tabs, at 32px.
5. Between tabs and tab content there is no stray background rectangle.
6. At most one draft/edit-related banner is visible at a time.
7. Every clickable or input control measures 32px tall.
8. Every card is `rounded-xl`; every button/input is `rounded-lg`.
9. Submitting an invalid form switches to the first tab with errors and shows a red count badge on it.
10. The sticky bottom footer renders inside the form and does not overlap the last card at the max scroll position.

A quick checklist that reviewers can run: `grep -nE 'rounded-xl|rounded-lg|px-4|py-3|amber-500/5|bg-amber|bg-orange' <changed files>` — any ad-hoc wrapper outside the kit is a smell.

## 9. Per-service rollout

Audit of the current tree (October 2026). Each entry names the files and the concrete offender.

### Draft/edit forms with duplicate or ad-hoc banners (highest priority — matches the user's screenshot)

- `src/app/(admin)/admin/products/[id]/edit/page.tsx` + `src/components/admin/ProductForm.tsx` — the exact bug. Outer `rounded-xl border border-amber-500/40 bg-amber-500/5` wrapper at `page.tsx:210-213` plus the inner `rounded-lg border border-amber-500/40 bg-amber-500/5` restore/discard banner at `ProductForm.tsx:3418-3440`. Fix: delete the outer wrapper, replace the inner one with `DraftNotice mode="draft"` or `"draft-with-local"`.
- `src/app/(admin)/admin/suppliers/[id]/edit/page.tsx` — same shape as products edit; one outer amber draft banner above `SupplierForm`. Replace with `DraftNotice`.
- `src/app/(admin)/admin/brands/[id]/edit/page.tsx` + `src/components/admin/BrandForm.tsx` — brand draft wrapper and in-form restore block; collapse to one `DraftNotice`.
- `src/app/(admin)/admin/coupons/[id]/edit/page.tsx` + `src/app/(admin)/admin/coupons/CouponForm.tsx` — same pattern.
- `src/app/(admin)/admin/review-forms/[id]/edit/page.tsx` + `.../ReviewFormForm.tsx` — same pattern.
- `src/components/admin/CategoryForm.tsx` (used by categories edit) — in-form restore banner; align radii and move the outer wording to `DraftNotice`.
- `src/components/admin/email-composer/EmailComposer.tsx` — autosave + draft indicators scattered through the composer; consolidate into the sticky footer autosave pill + one `DraftNotice`.
- `src/app/(admin)/admin/marketing/messaging/new/page.tsx` + `src/components/admin/messaging-templates/*` — draft messaging has its own ad-hoc amber strip and sidebar "pending" banner. Fold into the kit.

### Pages that assemble their own tab bar / header / notice stack

- `src/components/admin/ProductForm.tsx` — the whole `sticky top-0 … rounded-xl … px-3 bg-surface-elevated/95` wrapper around `Tabs` (ProductForm.tsx:3400-3415) draws its own background behind the tab line. Replace with the plain `Tabs` and let `FormPage` provide the frame. If sticky is really needed, add it to `Tabs` as a `sticky` prop rather than wrapping it.
- `src/app/(admin)/admin/controls/ControlsClient.tsx` — attributes toggle used to be inside the toolbar; still has a few sections drawing their own `rounded-xl` outer around sub-tabs.
- `src/app/(admin)/admin/campaigns/CampaignsListClient.tsx` and `.../[kind]/CampaignDetailClient.tsx` — custom banner/notice blocks sitting between the header and tabs; move to `notices` slot of `EntityPage` and use `Banner`.
- `src/app/(admin)/admin/google-ads/_components/{ConnectPanel,ConversionsView,ExperimentsView,AudiencesView,AlertsPanel}.tsx` — each defines its own amber/red cards; migrate to `Banner` + `Card`.
- `src/components/admin/ecom/tabs/OverviewTab.tsx` and `src/components/admin/ecom/ProvisioningLogsClient.tsx` — provisioning status strip has its own styling. Use `Banner` with the right tone.
- `src/app/(admin)/admin/customers/[id]/view/page.tsx` + `_components/CustomerConversations.tsx` — ad-hoc inline notices. Use the kit.
- `src/app/(admin)/admin/business/customers/[id]/BusinessCustomerDetailClient.tsx` — same.

### List pages with inconsistent toolbar/filter widths

- `src/app/(admin)/admin/products/page.tsx` — mostly done (the attribute panel landed in 0af71a15). Keep the toolbar as the reference for other list pages.
- `src/app/(admin)/admin/invoices/InvoicesClient.tsx` + `src/app/(admin)/admin/quotations/QuotationsClient.tsx` — toolbar filters are custom; move to `DataToolbar`.
- `src/app/(admin)/admin/orders/*` — list is mostly aligned; detail page's `UpdateOrderStatus` and `ReturnReview` draw their own red/amber stripes — convert to `Banner`.
- `src/app/(admin)/admin/customers/*` + `src/app/(admin)/admin/business/customers/*` — toolbars drift in widths; equalise with `DataToolbar`.
- `src/app/(admin)/admin/suppliers/*`, `src/app/(admin)/admin/purchase-orders/*` — same.
- `src/app/(admin)/admin/coupons/page.tsx` + `.../_components/CouponsTable.tsx` — toolbar OK, Advanced panel sometimes draws a different outer radius; align.
- `src/app/(admin)/admin/gst/page.tsx`, `src/app/(admin)/admin/labels/LabelsClient.tsx`, `src/app/(admin)/admin/offers/OffersClient.tsx`, `src/app/(admin)/admin/tasks/AdminTasksClient.tsx` — ad-hoc amber/orange banners for state; convert to `Banner`.
- `src/app/(admin)/admin/service-accounts/add/page.tsx`, `src/app/(admin)/admin/agent/page.tsx` — same.
- `src/app/(admin)/admin/customer-programs/_components/LoyaltyProgram.tsx` + `ReferralProgram.tsx` — mixed radii and backgrounds on state cards; convert to `Card` + `Banner`.
- `src/components/admin/channels/ChannelPanels.tsx` — several status rectangles; convert to `Banner`.

### Reference pages (already match the standard; use them as templates)

- `src/app/(admin)/admin/financial/...` AI costs tab — design reference the user already called out.
- `src/app/(admin)/admin/brands/page.tsx` + `_components/BrandsTable.tsx` — list pilot.
- `src/app/(admin)/admin/products/page.tsx` after commits 6f45393c and 0af71a15 — toolbar reference.
- `src/components/admin/kit/*` — authority.

## Rollout order

1. Land `DraftNotice` + `tone="draft"` in the kit, with the three documented states.
2. Add a `tabErrors` prop to `FormPage` and move the "switch to failing tab" logic there.
3. Delete the outer banner on `products/[id]/edit/page.tsx` and replace ProductForm's inner banner. Verify against the acceptance checks.
4. Repeat for suppliers → brands → coupons → review forms → categories → email composer → messaging. These all share the same two-banner shape, so each should be a small, mechanical change.
5. Sweep the list pages for ad-hoc banners (`grep -nE 'bg-amber-500/5|bg-orange-500/5'` across `src/app/(admin)/admin/**` and `src/components/admin/**` — the current audit lists them above).
6. Last pass: run the ten acceptance checks on every area in the sidebar and link the findings back into this doc.
