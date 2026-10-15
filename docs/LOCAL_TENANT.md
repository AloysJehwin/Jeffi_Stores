# Local tenant for testing

Spin up a real, isolated tenant entirely on your machine — its own Postgres DB, registered and
active in the local control plane, resolvable at `{slug}.localhost`. No AWS, never touches RDS.

## Create

```bash
npx tsx scripts/local-tenant.ts <slug> --plan growth
npx tsx scripts/local-tenant-admin.ts <slug> you@test.local "Your Name"
```

`local-tenant.ts` flags:
- `--plan basic|growth|pro|enterprise` (default `basic`)
- `--own-delhivery` — tenant ships on its own Delhivery account (COD enabled, no shipping wallet)
- `--own-razorpay` — tenant collects on its own Razorpay keys (no platform commission / Route)
- `--drop` — drop and recreate the tenant DB first

It creates `jeffi_tenant_<slug>`, loads the real tenant schema (`buildTenantSchemaSql`, the same the
provisioner uses), and upserts the `tenants` + `tenant_infra` rows (status `active`,
`rds_endpoint = localhost`).

## One-time env for the tenant admin

The `admin-{slug}` host requires a client cert in prod. For local use, skip that gate. Put it in
`.env.local.overrides` (gitignored) — NOT `.env.local`, which `deploy/load-secrets.mjs` overwrites
from Secrets Manager on every `predev`. The overrides file is merged on top and survives:

```
# .env.local.overrides
TENANT_MTLS_ENFORCED=false
```

Restart `npm run dev` after changing it.

## Open

With `npm run dev` running:

| URL | What |
|---|---|
| `http://<slug>.localhost:3000` | storefront (serves the tenant's own DB) |
| `http://admin-<slug>.localhost:3000/login` | tenant admin — enter the email; the OTP prints to the dev-server console (local mail is off) |
| `http://invoice-<slug>.localhost:3000` | public document host |

## How the host resolves

`slugFromHost` / `appFromHost` treat `*.localhost` as an alternate platform root, so
`{slug}.localhost`, `admin-{slug}.localhost`, `{slug}.business.localhost` resolve exactly like the
production `*.jeffistores.in` subdomains. Bare `localhost`, `admin.localhost`, `ecom.localhost` stay
platform (flagship). Production behaviour is unchanged.

The tenant DB is wired through `tenant_infra.rds_endpoint = localhost`; `buildTenantPool` connects
plainly (no TLS, no IAM) using the dev `DATABASE_URL` credentials, guarded on
`NODE_ENV !== 'production'`.

## Tear down

```bash
npx tsx scripts/local-tenant.ts <slug> --drop   # recreates empty; or drop the DB + control rows by hand
```

> `scripts/` is gitignored; these two are force-added. If they go missing, this doc has the usage
> and the code lives at `scripts/local-tenant*.ts`.
