# ADR-0004: Multi-portal architecture (visitor / business / admin)

- **Status**: Accepted
- **Date**: 2026-06-18
- **Authors**: engineering

## Context

Jeffi Stores serves two fundamentally different buyer segments:

- **B2C visitors** — retail customers browsing by brand/category, seeing MRP prices, paying via Razorpay at checkout.
- **B2B business accounts** — institutional buyers with negotiated pricing tiers, quote-based workflows, credit-term checkouts, and GST invoice requirements.

Admin operators are a third party entirely — they need product management, order fulfilment, inventory, and AI tooling without any of the storefront UX.

These three audiences differ enough that a single layout and routing tree would require constant conditional branching on user type, polluting every component with `if (isBusinessUser)` checks. More critically, the auth requirements differ: B2C customers use email/phone OTPs; B2B accounts use business credentials with different JWT scopes; admins use email + TOTP MFA.

Serving all three from the same route namespace also increases the blast radius of any auth bug — a misconfigured middleware check on `/products` could expose business pricing to anonymous visitors, or admin routes to business users.

## Decision

Split the application into three Next.js route groups with shared infrastructure:

| Portal | Route group | Auth type | Key differentiator |
|--------|------------|-----------|-------------------|
| Visitor | `/(app)` | Customer JWT (`type: 'customer'`) or anonymous | MRP pricing, Razorpay checkout |
| Business | `/business` | Business JWT (`type: 'business'`) | Tiered pricing, quote requests, GST checkout |
| Admin | `/admin` | Admin JWT (`type: 'admin'` + `role`) | Management UI, agent chat, label printing |

Routing is enforced in `middleware.ts`: the JWT payload `type` field is read on every request and compared against the route group. A `type: 'customer'` token attempting to access `/business/*` is redirected to `/business/login`. An unauthenticated request to `/admin/*` is redirected to `/admin/login`.

All three portals call the same `/api/*` route handlers. API routes perform their own token validation — they do not trust middleware alone. Business-specific API routes (`/api/admin/*`, `/api/business/*`) extract `type` from the verified JWT and reject mismatches with 403.

Shared components (cart logic, product queries, address forms) live in `src/components/visitor/`, `src/components/business/`, or `src/components/admin/` depending on which portal owns them, with no cross-portal imports.

## Consequences

**Positive**

- Auth isolation is structural, not conditional. Middleware + API-layer double-check means a single mischeck does not expose the wrong portal.
- Each portal can evolve independently. Business checkout adding credit-term UI does not touch visitor checkout.
- Onboarding a new developer is clearer: "you are working on the business portal, stay inside `/business` and `/api/business`."
- The JWT `type` field is a cheap, stateless discriminator — no extra DB lookup per request to determine portal membership.

**Negative**

- Some UI code is duplicated between visitor and business portals (product cards, category pages). Shared extraction requires careful abstraction to avoid smuggling business logic into visitor components.
- Three separate auth flows to maintain and keep consistent (cookie names, expiry, refresh logic).
- Middleware must be kept thin — any heavy computation here runs on every request.
