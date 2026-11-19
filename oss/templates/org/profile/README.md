<p align="center">
  <img src="https://raw.githubusercontent.com/Jeffi-ERP/.github/main/assets/jeffi-erp-logo.svg" alt="Jeffi ERP" width="96" height="96">
</p>

<h1 align="center">Jeffi ERP</h1>

<p align="center">
  The source of Jeffi Stores, a commerce platform for Indian merchants, with one repository per service.
  <br>
  <a href="https://jeffistores.in">jeffistores.in</a> ·
  <a href="https://github.com/Jeffi-ERP/workspace">Start with workspace</a> ·
  <a href="https://github.com/Jeffi-ERP/.github/blob/main/CONTRIBUTING.md">Contributing</a>
</p>

## What this is

Jeffi Stores runs [jeffistores.in](https://jeffistores.in) and a multi-tenant SaaS that runs stores for other merchants: a customer storefront, a store admin, a B2B portal and the platform control plane, with GST invoicing, Razorpay and UPI payments, Delhivery shipping, WhatsApp, SMS and email messaging, an AI gateway and an Expo mobile app. It is written in TypeScript: Next.js apps and Node.js services on PostgreSQL.

The platform is built in [AloysJehwin/Jeffi_Stores](https://github.com/AloysJehwin/Jeffi_Stores). Each service is exported from its `main` branch into a repository here, so you can read and change one service without the rest. Changes merged here go back upstream and come back with a later release.

## Repositories

| Repository | What it holds |
| --- | --- |
| [workspace](https://github.com/Jeffi-ERP/workspace) | Start here. Shared root config (package.json, tsconfig, Vitest, ESLint), the DB schema loader, and `oss/assemble.mjs`, which clones every other repo into place. |
| [storefront-service](https://github.com/Jeffi-ERP/storefront-service) | Customer storefront (Next.js): catalogue, search, cart, checkout, accounts. |
| [admin-service](https://github.com/Jeffi-ERP/admin-service) | Store admin panel (Next.js): products, orders, invoices, GST, CRM, campaigns. |
| [business-service](https://github.com/Jeffi-ERP/business-service) | B2B portal (Next.js): business accounts, RFQs, quotations, bulk ordering. |
| [controller-service](https://github.com/Jeffi-ERP/controller-service) | Platform control plane (Next.js): tenants, provisioning, plans, billing and the ecom portal. |
| [showcase-service](https://github.com/Jeffi-ERP/showcase-service) | One-page business websites (Next.js). |
| [messaging-service](https://github.com/Jeffi-ERP/messaging-service) | WhatsApp, SMS, email and push messaging: templates, sending and delivery tracking. |
| [document-service](https://github.com/Jeffi-ERP/document-service) | PDF documents: invoices, quotations, purchase orders, receipts. |
| [public-api-service](https://github.com/Jeffi-ERP/public-api-service) | Public REST API (`/v1`) for stores and integrations. |
| [mobile-service](https://github.com/Jeffi-ERP/mobile-service) | Mobile backend API and the Expo (React Native) shopping app. |
| [ai-platform](https://github.com/Jeffi-ERP/ai-platform) | AI gateway and SDK: chat, embeddings, vision and OCR with caching and a durable queue. |
| [store-core](https://github.com/Jeffi-ERP/store-core) | Shared core of the Next.js apps: UI components, domain logic, database access, auth and middleware. |
| [packages](https://github.com/Jeffi-ERP/packages) | Shared TypeScript packages: tenancy, service auth, pricing, GST, wallet, push, bulk jobs, the CLI and more. |

## Get started

```bash
git clone https://github.com/Jeffi-ERP/workspace.git jeffi-erp
cd jeffi-erp
node oss/assemble.mjs    # clones every repository into its folder
```

[CONTRIBUTING.md](https://github.com/Jeffi-ERP/.github/blob/main/CONTRIBUTING.md) covers the database, environment, dev server and checks.

## How a change gets in

```text
fork -> pull request to main
          |  a maintainer reviews it and adds ok-to-test (a new push removes it)
          v
        PR checks (lint, type check, unit tests) + Guard
          |
          v
        squash merge by the owner or the maintainers team
          |
          v
        Pre-build -> Build -> approval
          |
          v
        pull request in AloysJehwin/Jeffi_Stores -> release -> exported back here
```

Nothing runs on a pull request until a maintainer adds `ok-to-test`. Guard fails if a pull request changes managed files (`.github/`, `LICENSE`, and `oss/` in workspace); propose those changes in an issue.

## Licence

[Business Source License 1.1](https://github.com/Jeffi-ERP/workspace/blob/main/LICENSE). You can read, modify, redistribute and make non-production use of the code. Production use needs a commercial licence from Jeffi Stores until the Change Date, 2030-09-30, when the code becomes available under the Apache License 2.0. It is source-available, not open source. For a commercial licence, email support@jeffistores.in.

Contributions are licensed the same way, and contributors grant Jeffi Stores the right to relicense them. Details are in [CONTRIBUTING.md](https://github.com/Jeffi-ERP/.github/blob/main/CONTRIBUTING.md#licensing-of-contributions).

## Community

- [Contributing](https://github.com/Jeffi-ERP/.github/blob/main/CONTRIBUTING.md)
- [Code of conduct](https://github.com/Jeffi-ERP/.github/blob/main/CODE_OF_CONDUCT.md)
- [Security policy](https://github.com/Jeffi-ERP/.github/blob/main/SECURITY.md)
- [Support](https://github.com/Jeffi-ERP/.github/blob/main/SUPPORT.md)
- [Governance](https://github.com/Jeffi-ERP/.github/blob/main/GOVERNANCE.md)

Questions go to [Discussions](https://github.com/Jeffi-ERP/workspace/discussions). Anything private goes to support@jeffistores.in.
