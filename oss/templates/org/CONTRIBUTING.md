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

The services share root config and build together, so you work in an assembled workspace rather than a single repository.

You need:

- Node.js 20 and npm
- PostgreSQL 16 on your machine. Use a local database only; never point your environment at a shared or production database.
- Redis, optional (set `REDIS_URL` if you run it)

1. Clone the workspace and assemble it:

   ```bash
   git clone https://github.com/Jeffi-ERP/workspace.git jeffi-erp
   cd jeffi-erp
   node oss/assemble.mjs   # clones every repository into its folder
   npm ci
   ```

2. Create your environment file and fill it in for your machine:

   ```bash
   cp .env.example .env.local
   ```

   Set `DATABASE_URL` to an empty local database and load the schema into it, in the order `node scripts/db-files.mjs` prints the files (the platform set), then the control-plane tables:

   ```bash
   createdb jeffi_dev   # DATABASE_URL=postgresql://localhost:5432/jeffi_dev
   for f in $(node scripts/db-files.mjs) $(node scripts/db-files.mjs control-plane); do
     psql -d jeffi_dev -q -v ON_ERROR_STOP=1 -f "$f"
   done
   ```

   Never commit `.env.local`.

3. Start the apps:

   ```bash
   ALLOW_ENV_FALLBACK=true npm run dev
   ```

   This starts the storefront, admin, business and controller apps behind a dev router on port 3000. `ALLOW_ENV_FALLBACK=true` lets the secrets loader carry on when it can't reach AWS, so the apps run on your `.env.local`.

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
