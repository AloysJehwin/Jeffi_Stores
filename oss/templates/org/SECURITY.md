# Security policy

This code runs live stores, including stores for other merchants. Report vulnerabilities privately so they can be fixed before they are public.

## Reporting a vulnerability

Do not open a public issue, discussion or pull request for a security problem. Report it privately in one of these ways:

- the **Report a vulnerability** button on the **Security** tab of the repository the problem is in, or
- email to **support@jeffistores.in**.

Please include:

- what the problem is and what an attacker could do with it;
- steps to reproduce, or a proof of concept against a local setup;
- the repository and the commit you tested;
- any logs or request details that help, with secrets and personal data removed.

We aim to acknowledge a report within 3 business days and to keep you updated while we work on a fix.

## Scope

In scope is the code in the Jeffi ERP repositories, including:

- tenant isolation: one store reading or changing another store's data, settings or credentials;
- authentication, sessions, one-time codes and staff access;
- payments, refunds, invoices and GST;
- the shipping, messaging, document, public API and mobile endpoints;
- the AI gateway;
- the contribution pipeline: getting code to run in CI without the `ok-to-test` label, getting a managed file past Guard, or reading CI secrets.

Out of scope:

- third-party services the platform uses (Razorpay, Delhivery, AWS, Google, Meta and others); report those to the vendor;
- denial-of-service, load or volumetric testing;
- social engineering and physical attacks;
- scanner output without a demonstrated impact.

## Testing rules

- Test against your own local setup ([CONTRIBUTING.md](https://github.com/Jeffi-ERP/.github/blob/main/CONTRIBUTING.md#set-up-the-workspace) shows how). Never test against jeffistores.in, ecom.jeffistores.in or any store running on the platform.
- Don't access, change or keep data that isn't yours. If you come across customer or order data, stop, delete anything you saved and say so in your report.

## Supported versions

Only `main` of each repository is supported. Fixes are made on `main` and ship in the next release.

## Disclosure

Give us a reasonable chance to fix a problem before you disclose it publicly. We are happy to credit reporters who follow this policy.

## Secrets in the code

The repositories must never contain real credentials. Configuration comes from environment variables and a secrets manager at runtime; `.env.example` shows its shape. If you find a committed secret, report it privately as above so it can be rotated.
