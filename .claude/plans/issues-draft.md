# Issue batch draft (for approval)

Labels to create: `tenant-isolation`, `security`, `ai`, `data-sources`, `dark-mode`, `mobile`,
`ui`, `admin`, `storefront`, `ecom-portal`, `major-release` (plus GitHub defaults `bug`, `enhancement`).

---

## 1. fix(tenant): remove hardcoded "Jeffi" store name and logo from tenant-facing surfaces
Labels: bug, tenant-isolation

The platform name and logo are hardcoded in several places, so tenant stores show Jeffi branding.
Known spots: the admin AI agent, and the Delhivery shipping label (reuses the Jeffi logo).

Acceptance criteria
- [ ] Audit every hardcoded store name / logo reachable from a tenant host.
- [ ] Shipping labels, packing slips, invoices, emails, SMS and AI agent prompts use the tenant's
      store name and logo from its settings.
- [ ] Platform-only surfaces (jeffistores.in, admin.jeffistores.in, ecom portal) may keep Jeffi branding.
- [ ] Regression test or lint check that fails on new hardcoded brand strings in tenant paths.

## 2. fix(tenant): team members page broken on tenants; certificates only via certificates.jeffistores.in
Labels: bug, tenant-isolation, security

The team members component does not work on tenant admins. Certificate delivery must be centralised.

Acceptance criteria
- [ ] Team members page works on tenant admins.
- [ ] No certificate can be downloaded from the admin or super admin panels.
- [ ] Certificates are no longer emailed, with or without a password.
- [ ] Certificates are issued to certificates.jeffistores.in only, properly validated there, and the
      admin downloads them directly from that host.

## 3. fix(tenant): stop provisioning the administrator role into tenants
Labels: bug, tenant-isolation, security

Every provisioned tenant gets an administrator entry. Tenant hierarchy is super admin > admin > moderator.
The administrator role exists only on the main store (admin.jeffistores.in: administrator > super admin > admin > moderator).

Acceptance criteria
- [ ] Provisioning no longer creates an administrator user or role on tenants.
- [ ] Existing tenants cleaned up via the schema/fan-out pipeline.
- [ ] Tenant hosts reject administrator scope in auth and scope checks.
- [ ] Tests for tenant role hierarchy.

## 4. fix(ai): tenant on-device LLM and fine-tuning not working; design a shared LLM layer
Labels: bug, ai, tenant-isolation

The on-device LLM on tenants does not work properly and fine-tuning appears not to apply.

Acceptance criteria
- [ ] Diagnose and fix tenant on-device LLM inference.
- [ ] Verify fine-tuning is applied (or document why not).
- [ ] Design a proper shared LLM layer for tenant users with per-tenant isolation (cache namespace,
      no platform data leaking into tenant answers, incl. the open rag.ts tenant routing).

## 5. feat(billing): refactor ecom plan pricing
Labels: enhancement, ecom-portal, major-release

Refactor the plans and pricing of the ecom platform. Ships as a major release. Pricing was removed
from the ecom landing pending this work.

Acceptance criteria
- [ ] New plan and price structure agreed and documented.
- [ ] Control-plane plans, billing and the /pricing page updated.
- [ ] Migration path for existing tenants on current plans.

## 6. fix(data-sources): Google Sheets connect redirects tenants to admin.jeffistores.in
Labels: bug, tenant-isolation, data-sources

Connecting a Google Sheet from a tenant admin returns the user to the main store's admin instead of
the tenant's.

Acceptance criteria
- [ ] OAuth callback returns to the originating tenant admin host.
- [ ] The return host is carried in signed state and validated against the tenant's own hosts.
- [ ] No cross-tenant redirect or session confusion; test for a tenant host.

## 7. fix(data-sources): default values for optional fields in Google Sheets and CSV imports
Labels: bug, data-sources

Fields marked optional in the template can arrive blank and break or corrupt the sync.

Acceptance criteria
- [ ] Documented default for every optional template field.
- [ ] Blank cells fall back to the default for both Google Sheets and CSV.
- [ ] Sync succeeds on rows with blank optional fields; tests cover it.

## 8. fix(admin): dark theme contrast refactor
Labels: bug, ui, dark-mode, admin

Admin components have poor contrast against each other in dark mode.

Acceptance criteria
- [ ] Audit admin surfaces in dark mode.
- [ ] Text and interactive elements meet WCAG AA contrast; surfaces are distinguishable.

## 9. fix(ui): dark theme flashes light on page load
Labels: bug, ui, dark-mode

The page renders in light mode first and then switches to dark.

Acceptance criteria
- [ ] Theme is resolved before first paint (server-rendered class or blocking inline script).
- [ ] No light frame on initial load or navigation, on any page.

## 10. refactor(ui): send all inline status messages to the unified toast service
Labels: enhancement, ui, admin

Status messages appear inline between components (for example "Sync started" on data sources).

Acceptance criteria
- [ ] Every status message uses the toast service with its three levels: error, warning, success.
- [ ] Inline message banners removed.
- [ ] Open question: whether field-level form validation stays inline.

## 11. feat(storefront): order-placed celebration and micro-animations
Labels: enhancement, storefront, ui

No post-payment moment after an order is placed.

Acceptance criteria
- [ ] Animated order-placed scene after successful payment.
- [ ] Add-to-cart animation; list other places where animation adds engagement.
- [ ] Respects prefers-reduced-motion.

## 12. feat(storefront): quick-add button on product cards with variant and selling-unit picker
Labels: enhancement, storefront

Acceptance criteria
- [ ] A "+" button on product cards on every listing page.
- [ ] Products without variants add directly; products with variants open a popup to choose the variant.
- [ ] Quantity in the popup follows the product's selling unit (step and minimum).
- [ ] Adds to cart and confirms via toast.

## 13. fix(admin/mobile): finance page tabs overflow the viewport
Labels: bug, mobile, admin

Acceptance criteria
- [ ] Finance tabs fit or scroll within the viewport on mobile with no page overflow.

## 14. feat(admin/mobile): unified list, view and popup pattern on mobile, starting with products
Labels: enhancement, mobile, admin

Product list rows on mobile show too little, and there is no product view page on mobile.

Acceptance criteria
- [ ] Richer product list rows on mobile.
- [ ] A product view page on mobile.
- [ ] Every admin list page offers list, view and popup on mobile, matching desktop.

## 15. feat(ecom): primary store journey demo matching the real product at 80-90%
Labels: enhancement, ecom-portal

Acceptance criteria
- [ ] The ecom landing demo components match the real storefront and admin at 80-90%.

## 16. feat(ecom): more engaging components across the ecom portal
Labels: enhancement, ecom-portal

Acceptance criteria
- [ ] Additional engaging, interactive components to increase engagement.

## 17. feat(ecom): interactive mockup page for every app
Labels: enhancement, ecom-portal

Every app in the ecom "All apps" grid gets its own page with an interactive mockup of its real flow,
matching the product at 80-90%. Built one app at a time.

Acceptance criteria
- [ ] Products & variants (done, pending commit).
- [ ] Remaining 29 apps, in group order: Catalogue, Sales, Fulfilment, Finance, Marketing, B2B, Growth & ops.

## 18. feat(ecom): support ticketing system
Labels: enhancement, ecom-portal, admin

New feature: support requests become tickets.

Acceptance criteria
- [ ] Support form that creates a ticket.
- [ ] Rich text editor with inline images and media (evaluate open-source editors; reuse the mailer's if suitable).
- [ ] New "Tickets" (support) section in the admin panel under E-com.
- [ ] Integrated with the existing email service for notifications and replies.

## 19. feat(storefront): more engaging, animated homepage components
Labels: enhancement, storefront, ui

Acceptance criteria
- [ ] New animated homepage sections (motion, GIF-style) available in Settings > Homepage.
- [ ] Respect prefers-reduced-motion.
