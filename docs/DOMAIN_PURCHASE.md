# Buying a domain through the ecom portal

_Added 2026-11-13. Not deployed. Off in production until `DOMAIN_REGISTRAR=route53` is set._

A store owner buys a domain from the ecom portal (onboarding Store step, or Dashboard → Domains). We register it in the owner's name with Route 53 Domains from the platform's AWS account, charge the first year to the store's wallet, and move every host the store's plan has onto it with HTTPS. It renews yearly from the wallet.

## Flow

| Status (`tenant_domain_orders`) | Step | What happens |
| --- | --- | --- |
| `requested` | `charge` | Debit the wallet (`category='domain'`, ref `domain:<order>`). Waits for an approved store (`active`/`provisioning`) and enough balance; re-checks availability first and cancels with nothing charged if the name is gone. |
| `registering` | `register` | `RegisterDomain` once (1 year, AWS auto-renew **off**, privacy on all contacts), then `GetOperationDetail` until `SUCCESSFUL`. `ERROR`/`FAILED` (or a non-retryable error) refunds the wallet (`domain_refund:<order>`) and marks `failed`. A retry after a crash looks the operation up (`ListOperations`) before registering again. |
| `configuring` | `zone` → `records` → `routing` → `certs` | Find the hosted zone registration created, UPSERT A records for every host to `CLUSTER_INGRESS_IP`, write the hosts as `tenant_custom_domains` rows (`order_id` set, status `cert-pending`), re-render the store's routes, wait for each cert-manager certificate. Waits for the store to be live before routing. Problems here retry with backoff and never refund (the domain is registered and paid). |
| `active` | | Serving. Each tick checks the registrant confirmed their email (registries suspend after 15 days) and that the hosts still match the plan. |
| `failed` / `cancelled` / `expired` | | Final. |

The row is the job: `advanceOrder` takes a session advisory lock, moves as far as it can, and saves after every external call. It is driven by the `domain_orders` cron (every 5 min) and by the owner's page, which asks it to move along every 4 s while a domain is registering or setting up. Progress events are on the row (`events`) and shown to the owner.

Onboarding: the Store step searches and picks; the Review step collects the registrant contact; submit creates a `requested` order (`source='onboarding'`). It is bought from the wallet once the store is approved, or with **Buy now** on the dashboard.

## Hosts on the bought domain

Every host the plan gives the store (`tenantHostnames` in `lib/provisioning/steps.ts`) is served on the domain:

| Platform host | On the bought domain | Served by |
| --- | --- | --- |
| `{slug}.jeffistores.in` | `brand.in`, `www.brand.in` | storefront |
| `admin-{slug}` | `admin.brand.in` | admin, behind the store's mTLS option (`tenant-mtls`) and the same tenant-CA client-cert check as `admin-{slug}` |
| `invoice-` / `quotation-` / `purchaseorder-{slug}` | `invoice.` / `quotation.` / `purchaseorder.brand.in` | the store's document-service |
| `forms-` / `vault-{slug}` | `forms.` / `vault.brand.in` | storefront |
| `{slug}.business` (Pro+) | `business.brand.in` | business |

A plan change adds or drops hosts on the next tick. Routing is by first label (`lib/tenancy/admin-host.ts` `customHostApp`): `appFromHost`, `hostClasses`, the middleware and the k8s renderer all use it. This is safe because owners can't add a bring-your-own domain starting with any of those labels (`addCustomDomain` reserves them), so only the purchase job creates such rows, and an unknown one resolves to no store (404). `admin.<domain>` is never the platform admin: `/ecom` is 404 there and its sessions must belong to that store.

Each host gets its own cert-manager `Certificate` (Let's Encrypt HTTP-01), like bring-your-own domains. No ACM.

## Pricing

`price = ceil(AWS USD price × usdInr × (1 + margin))` per year, from the wallet (top-ups already carry GST, so none is added). `usdInr` is the server-pricing catalog's rate; the margin (default 25%), the renewal window and cut-off and the TLDs offered are `platform_infra` key `domain_pricing`, edited in admin **Ecom Store → Domains**. The first year's price, cost, rate and margin are snapshotted on the order; each renewal snapshots its own.

## Renewal policy

- AWS auto-renew is off on every domain, so AWS never renews on its own at the platform's cost.
- `renewLeadDays` (30) before expiry a `tenant_domain_renewals` row opens for the term (daily `domain_renew` cron).
- Auto-renew on: debit the current renewal price + margin, **then** `RenewDomain`. The charge ref is saved before the debit, so a retry never charges twice. Success extends `expires_at` (from `GetDomainDetail`).
- Wallet short: no renewal. Email the owner, retry daily, re-email every 5 days. The dashboard shows the shortfall with **Top up** and **Renew now**.
- Store not active (suspended, closed): treated like a short wallet.
- Registry rejects the renewal: refund, email, retry the next day.
- Still unpaid `renewCutoffDays` (3) before expiry: `lapsed`, email "will expire". At expiry the order is `expired`, its hosts stop resolving and leave the store's routes, and the store stays on its jeffistores.in hosts.
- Auto-renew off: reminders when the window opens, 7 days and 1 day before expiry.

## Local and tests

`lib/domains/providers`: `DomainRegistrar` (Route 53 Domains), `DomainDns` (Route 53), `DomainHosting` (cluster routes + certificates). The real ones are built only when `DOMAIN_REGISTRAR=route53` **and** `NODE_ENV=production` and not under vitest; everything else gets the fake, which never calls AWS or the cluster. In production without the variable the feature is off (search returns 503).

The fake: an operation finishes `DOMAIN_FAKE_OP_SECONDS` (20) after it starts; a label containing `taken` is unavailable, `premium` premium, `fail` makes registration fail (refund path), `renewfail` makes renewal fail. Certificates are "issued" half that time after the route is written.

## Production needs

1. **Env** on the controller: `DOMAIN_REGISTRAR=route53`. `CLUSTER_INGRESS_IP` is already set for bring-your-own domains.
2. **IAM** for the controller's AWS identity:
   - `route53domains:CheckDomainAvailability`, `GetDomainSuggestions`, `ListPrices`, `RegisterDomain`, `GetOperationDetail`, `ListOperations`, `GetDomainDetail`, `RenewDomain`, `GetContactReachabilityStatus` on `*` (domain actions can't be resource-scoped).
   - `route53:CreateHostedZone` on `*` (RegisterDomain creates the zone).
   - `route53:ListHostedZonesByName` on `*`, `route53:ChangeResourceRecordSets` on `arn:aws:route53:::hostedzone/*`.
   - No ACM.
3. **AWS account**: domain registrations are charged immediately to the account's payment method (not covered by credits). Route 53's default quota is 20 registered domains per account; request an increase before launch. Check the account's contact details are current (AWS emails the account about registrations).
4. **TLDs**: only TLDs both in the configured list and in `ListPrices` are offered. Some TLDs (for example `.in`) restrict privacy protection or need extra contact fields; a registration the registry rejects is refunded automatically, but check the TLDs you offer once with a real purchase.
5. **cert-manager**: uses the existing `letsencrypt-http` ClusterIssuer. Let's Encrypt allows 50 certificates per registered domain per week; a domain uses up to 9.
6. **Google sign-in** on the new hosts needs their redirect URIs added to the Google OAuth client by hand; until then owners sign in with the email code.

## Not built

- Document and email links still use `invoice-{slug}.jeffistores.in` etc.; making the bought domain canonical is a follow-up.
- Moving a domain away (auth code / transfer to the owner) is manual.
- Deprovisioning a store does not delete its bought domains; they lapse at expiry (auto-renew is off at AWS and renewal needs an active store).
