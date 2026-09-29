# Security Policy

Jeffi Stores is a production, multi-tenant commerce platform. We take the security of the
platform and of every store running on it seriously.

## Reporting a vulnerability

**Do not open a public issue for a security vulnerability.**

Report suspected vulnerabilities privately using GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(the **Report a vulnerability** button on the Security tab), or email **support@jeffistores.in**.

Please include:

- A clear description of the issue and its impact.
- Steps to reproduce, or a proof of concept.
- Affected area (storefront, admin, tenant provisioning, payments, delivery, AI gateway, etc.).
- Any relevant logs, request IDs or timestamps (redact secrets and personal data).

We aim to acknowledge a report within 3 business days and to keep you updated as we work on a fix.

## Scope

In scope: this repository's application code, its APIs, tenant isolation, authentication and
session handling, payment and delivery integrations, and the AI gateway.

Out of scope: third-party services we integrate with (Razorpay, Delhivery, AWS, Google), and
denial-of-service or volumetric testing against live infrastructure. Please do not test against
production tenants or attempt to access data that is not yours.

## Handling of secrets

This repository must never contain real credentials. Configuration is supplied through environment
variables and a secrets manager at runtime; see `.env.example` for the shape of the configuration.
If you believe a secret has been committed, report it privately as above so it can be rotated.

## Coordinated disclosure

We ask that you give us a reasonable opportunity to remediate an issue before any public
disclosure. We are happy to credit reporters who follow this policy.
