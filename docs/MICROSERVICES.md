# Microservices — current scope

## Where we are today

**Only the SERVICES are segregated. The DATABASE is unified.**

Services:
- Next.js monolith (admin + ecom + storefront)
- `messaging-service` (SMS/email/WhatsApp send + templates library)
- `document-service` (invoice/quotation/PO rendering + storage)

Every service connects to **the same database**:
- **Local**: `jeffi_production_ready` (port 5432)
- **Prod**: the single Jeffi DB

That one DB holds every entity:
- **control-plane entity** — `tenants`, `plans`, `plan_features`, `owners`, `api_keys`, `tenant_infra`, `wallet_*`, `auth_sessions`
- **messaging entity** — `messages`, `message_events`, legacy `message_templates`
- **documents entity** — `documents`, `document_sequences`
- **templates library** — `template_*` (per-tenant copies), `platform_template_*` (singleton defaults), `pub_template_*` (public-API customer copies), `brand_theme`, `sms_dlt*`, `short_link`, `waba_capacity`, `wa_pricing`
- **business tables** — products, orders, campaigns, …

The DBs `jeffi_control_plane`, `jeffi_messaging`, `jeffi_documents` are **legacy** from an earlier design that jumped straight to per-service DBs. They should not be used. The service `.env.local` URLs now all point at `jeffi_production_ready`.

## Where we're going

**Multi-tenant.** When we onboard real tenants:
- Each **tenant** gets its own DB (e.g. `jeffi_tenant_<slug>`).
- Services still connect to the **main DB** for the control-plane entity (tenant registry, api keys, wallet, …).
- Services connect to the **tenant DB** for that tenant's business data (products, orders, templates).
- Resolution: the service-auth claim carries `tenant_id`; the service's tenancy resolver (`packages/tenancy`) opens a connection to the right tenant DB.

**Per-service DB split**: later. Not now. When traffic patterns force it, we'll peel `messaging-service` off into its own DB (send log is high-churn), `document-service` into its own, etc. The current unified DB is a conscious phase-1 choice.

## Rules

1. **New tables land in `jeffi_production_ready`** — via the main `database/*.sql` pipeline (topic file + `constraints.sql` + `indexes.sql`).
2. **Do not create new DBs.** `jeffi_control_plane`, `jeffi_messaging`, `jeffi_documents` are deprecated. Their schema files remain as historical references but are not applied against new DBs.
3. **Service `.env` DB URLs all point at `jeffi_production_ready`.** `CONTROL_PLANE_DATABASE_URL`, `MESSAGING_DATABASE_URL`, `DOCUMENTS_DATABASE_URL`, `DATABASE_URL` — all the same URL today.
4. **Apply only to LOCAL DB.** Never run DDL against the live RDS.
5. **Multi-tenant lives in the services, not the DBs.** When tenants arrive, each gets a dedicated DB; the service picks the right connection via the tenancy resolver using the `tenant_id` in the service-auth claim.
