# Contributing to Jeffi ERP

Jeffi ERP holds the source of Jeffi Stores, a commerce platform for Indian merchants, with one repository per service. Bug fixes, features, tests and docs are welcome. This guide applies to every repository in the org.

The code is under the Business Source License 1.1 (the `LICENSE` file in each repository). Read [Licensing of contributions](#licensing-of-contributions) before you send code.

## Before you start

- Search the existing issues and [Discussions](https://github.com/Jeffi-ERP/workspace/discussions) first.
- For anything bigger than a small fix, open an issue and agree on the approach before you write code. This matters most for changes that span several repositories, add a dependency or change the database schema.
- File issues in the repository the change belongs to; the [org page](https://github.com/Jeffi-ERP) says what each one holds. If you are not sure, use [workspace](https://github.com/Jeffi-ERP/workspace).
- Never report a security problem in an issue. Follow [SECURITY.md](https://github.com/Jeffi-ERP/.github/blob/main/SECURITY.md).
- Never paste secrets, API keys, tokens, `.env` values, customer data or order details into an issue, pull request, commit, test fixture or screenshot.
- Follow the [Code of Conduct](https://github.com/Jeffi-ERP/.github/blob/main/CODE_OF_CONDUCT.md).

## Set up the workspace

The services share root config and build together, so you work in an assembled workspace rather than a single repository. You never need Jeffi Stores' own keys: you generate local secrets, and every integration (AWS, payments, shipping, email, SMS, AI) stays off unless you add your own sandbox key. A one-command setup is planned in [workspace#10](https://github.com/Jeffi-ERP/workspace/issues/10); until then, follow these steps.

You need:

- Node.js 20.6 or later, and npm
- Docker, for PostgreSQL 16 with the pgvector extension. A local PostgreSQL with pgvector works too. Use a local database only; never point your environment at a shared or production one.
- `openssl`, to generate secrets

1. Clone the workspace and assemble it:

   ```bash
   git clone https://github.com/Jeffi-ERP/workspace.git jeffi-erp
   cd jeffi-erp
   node oss/assemble.mjs                  # clones every repository into its folder
   ONNXRUNTIME_NODE_INSTALL=skip npm ci   # skips onnxruntime's CUDA download
   ```

2. Start a database, then load the schema and the plans in the order CI uses:

   ```bash
   docker run -d --name jeffi-pg -p 5432:5432 \
     -e POSTGRES_USER=jeffi -e POSTGRES_PASSWORD=jeffi -e POSTGRES_DB=jeffi_dev pgvector/pgvector:pg16
   for f in $(node scripts/db-files.mjs) $(node scripts/db-files.mjs control-plane) \
            controller-service/database/seeds/seed-plans.sql; do
     docker exec -i jeffi-pg psql -U jeffi -d jeffi_dev -q < "$f"
   done
   ```

   One error is expected for now: `relation "shelf_stock_unique" already exists`. Everything else loads.

3. Write `.env.local` with fresh secrets, and link it into each app's folder (Next.js reads env files from the app's own folder):

   ```bash
   cat > .env.local <<EOF
   DATABASE_URL=postgresql://jeffi:jeffi@localhost:5432/jeffi_dev
   JWT_SECRET=$(openssl rand -hex 32)
   MFA_ENCRYPTION_KEY=$(openssl rand -hex 32)
   SERVICE_AUTH_SECRET=$(openssl rand -hex 32)
   SOCIAL_TOKEN_ENC_KEY=$(openssl rand -hex 32)
   CRON_SECRET=$(openssl rand -hex 16)
   APP_URL=http://localhost:3000
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   NEXT_PUBLIC_BASE_URL=http://localhost:3000
   NEXT_PUBLIC_SITE_URL=http://localhost:3000
   ADMIN_BASE_URL=http://localhost:3000/admin
   PLATFORM_OWNER_EMAIL=admin@example.test
   MAIL_DISABLED=true
   SMS_DISABLED=true
   WHATSAPP_DISABLED=true
   IN_PROCESS_CRON=false
   TENANT_MTLS_ENFORCED=false
   ADSENSE_DISABLED=true
   ENABLE_RAZORPAY=false
   ENABLE_UPI=false
   ENABLE_GST=false
   AI_GATEWAY_URL=http://127.0.0.1:8080
   RAG_PG_HOST=127.0.0.1
   EOF
   for app in controller-service storefront-service admin-service business-service showcase-service; do
     ln -sf ../.env.local "$app/.env.local"
   done
   ```

   `.env.example` lists every other setting. Leave integration keys empty unless you have your own sandbox account (for example Razorpay test mode). Never commit `.env.local`.

4. Create a local admin:

   ```bash
   docker exec -i jeffi-pg psql -U jeffi -d jeffi_dev <<'SQL'
   WITH u AS (INSERT INTO users (email, first_name, last_name)
              VALUES ('admin@example.test', 'Local', 'Admin') RETURNING id)
   INSERT INTO admins (user_id, role) SELECT id, 'administrator' FROM u;
   SQL
   ```

5. Start the apps:

   ```bash
   ALLOW_ENV_FALLBACK=true npm run dev
   ```

   The secrets loader tries AWS, fails, and carries on with your `.env.local`. The dev router serves everything on port 3000:

   - http://localhost:3000 is the storefront.
   - http://localhost:3000/admin is the admin. Sign in as `admin@example.test` with the email code `000000` (accepted outside production), then enrol any authenticator app.
   - http://ecom.localhost:3000 is the ecom console. Stores run on `<slug>.localhost:3000`.

Not working locally yet: placing orders (shipping needs a local stand-in), product images stored in S3, and AI features. They are part of [workspace#10](https://github.com/Jeffi-ERP/workspace/issues/10).

## Work on a repository

The workspace root is the workspace repository, and each service folder is a clone of its own repository (store-core sits at `packages/store-core`, inside the packages clone). Fork the repository you want to change, then add your fork as a remote in that folder:

```bash
cd admin-service
git remote add fork https://github.com/<your-username>/admin-service.git
git switch -c fix/short-description
# make your change
git commit -s -m "fix(orders): short description"
git push -u fork fix/short-description
```

Then open a pull request from your fork against `main`.

## Check your change

From the workspace root, run the same checks as PR checks for the repository you changed:

```bash
node oss/checks.mjs admin-service pr       # lint, type check, unit tests
node oss/checks.mjs admin-service --list   # print the commands instead
```

Or run single commands. The examples use admin-service and messaging-service; swap in yours.

| Check | Command |
| --- | --- |
| Lint a Next.js app | `npx next lint admin-service` |
| Type check a Next.js app | `npx tsc --noEmit -p admin-service/tsconfig.typecheck.json` |
| Unit tests (Vitest project) | `npx vitest run --project admin` |
| Type check another service | `npm --prefix messaging-service run typecheck` |
| Tests for another service | `npm --prefix messaging-service test` |

Vitest projects: `store-core`, `storefront`, `admin`, `business`, `controller`, `showcase`, `cli`.

## Database changes

Each table belongs to one service, and its DDL lives in that service's `database/` folder:

- `tables/<topic>.sql`: `CREATE TABLE` and `CREATE SEQUENCE`
- `constraints.sql`: primary keys, unique and check constraints, defaults
- `foreign-keys.sql`: foreign keys
- `indexes.sql`: indexes

To add a table, column or index, edit those files, mirroring an existing table. Don't write a migration for it: the schema files are the source of truth and releases apply the difference.

Migrations (`database/migrations/`) are only for destructive or data changes. Name them `YYYY-MM-DD_what.sql`, use a name no other service uses, and make them safe to run twice.

## Code style

- Match the surrounding code.
- Don't reformat files or lines you aren't changing, and don't run Prettier or another formatter over the code. The repositories are deliberately not auto-formatted, and reformatting buries the real change.
- Keep comments short; prefer clear names.
- No emoji in code, UI copy, emails or commit messages.
- Keep files under 500 lines.
- Keep each pull request to one change, and add or update tests for behaviour you change.
- Tenant isolation: code that reads tenant data must resolve the tenant from the request context, never from client input, and must never fall back to another tenant's data or credentials.

## Pull requests

1. Open the pull request from your fork against `main`. The title must be a conventional commit, `type(scope): subject`, where type is one of `feat`, `fix`, `perf`, `refactor`, `revert`, `docs`, `test`, `ci`, `build` or `chore`. Pull requests are squash-merged.
2. Nothing runs when you open it. A maintainer reviews the change and adds the `ok-to-test` label, which runs two checks: **Guard** (step 4) and **PR checks**, which assembles the workspace from all the org repositories and runs lint, type check and unit tests for your repository.
3. Any new push removes `ok-to-test`. A maintainer adds it again after reading the new commits.
4. Guard fails if the pull request changes managed files: anything under `.github/`, the `LICENSE` file, and in workspace the `oss/` folder. Those files are generated from the upstream repository; propose changes to them in an issue.
5. Only the owner and the `maintainers` team can merge, and only once the checks pass.
6. Merging starts a pipeline: **Pre-build** (lint, type check), then **Build** (tests, production build), then an approval stage. Once a maintainer approves, the change is opened as a pull request in [AloysJehwin/Jeffi_Stores](https://github.com/AloysJehwin/Jeffi_Stores) and ships with a later release. When that release lands, the export brings it back to the org repository with nothing lost.

### What a maintainer checks before adding ok-to-test

The label lets your code run in CI, so a maintainer reads the whole diff first and holds the label back if the pull request:

- touches workflows, actions, the `LICENSE` file or other managed files;
- adds or changes dependencies, lockfiles, install scripts or package.json scripts without a clear need;
- changes build, test or lint configuration more than the change requires;
- reads environment variables, credentials or files outside the repository, or makes network calls from tests or build steps;
- contains generated, minified, obfuscated or binary content that can't be reviewed;
- includes secrets, customer data or order details;
- does something other than what its description says.

Small, focused pull requests get labelled sooner.

## Sign off your commits

Add a `Signed-off-by` line to every commit with `git commit -s`. It certifies the [Developer Certificate of Origin](https://developercertificate.org): that you wrote the change, or otherwise have the right to submit it under the project's licence. To sign off commits you have already made, run `git rebase --signoff origin/main` and force-push the branch.

## Licensing of contributions

By opening a pull request you agree that:

- your contribution is licensed under the Business Source License 1.1 in the repository's `LICENSE` file, on the same terms as the rest of the code, including the change to the Apache License 2.0 on the Change Date; and
- you grant Jeffi Stores a perpetual, worldwide, non-exclusive, royalty-free, irrevocable licence to use, copy, modify, distribute, sublicense and relicense your contribution under other terms, including commercial licences. Jeffi Stores needs this to keep offering commercial licences for the platform.

You keep the copyright in your contribution. If your employer has rights in your work, make sure you are allowed to contribute it.

## Questions

Ask in [Discussions](https://github.com/Jeffi-ERP/workspace/discussions). [SUPPORT.md](https://github.com/Jeffi-ERP/.github/blob/main/SUPPORT.md) covers everything else.
