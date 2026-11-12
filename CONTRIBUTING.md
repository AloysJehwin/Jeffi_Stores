# Contributing

Thanks for your interest in Jeffi Stores. This repository is the source of a live, multi-tenant
commerce platform, published under the Business Source License 1.1 (see `LICENSE`). Issues and
pull requests are welcome.

## Reporting bugs and requesting features

- Search existing issues first.
- Use the issue templates (bug report or feature request).
- **Security problems must not be filed as issues.** Follow `SECURITY.md` instead.
- Never paste secrets, tokens, customer data or order details into an issue.

## Development setup

Requirements: Node.js 18 or later, PostgreSQL, and npm.

```bash
npm ci
cp .env.example .env.local   # fill in values for your local environment
npm run dev
```

Useful scripts:

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run lint` | Lint |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Production build |

## Database changes

The schema lives in split, `pg_dump`-style files in the `database/` folder of the service that owns each table
(`docs/DATABASE_OWNERSHIP.md`):

- tables in a topic file under `tables/` (`admin-service/database/tables/catalog.sql`, ...),
- primary keys, CHECK constraints and sequence owners in that service's `constraints.sql`,
- foreign keys in its `foreign-keys.sql`, indexes in its `indexes.sql`.

`scripts/db-files.mjs` lists the files in load order and the schema pipeline applies them. Do not add migration
files for new tables.

## Pull requests

- Branch from `main` and open the pull request against `main`.
- The PR title must be a conventional commit: `type(scope): subject`, where type is one of
  `feat fix perf refactor revert docs test ci build chore`. Releases are generated from these.
- Required checks: Build, Lint, Type Check, Test & Coverage and Pipeline Summary must pass.
- Keep changes focused. Add or update tests for behaviour you change.
- Tenant isolation matters: code that reads tenant data must resolve the tenant from the request
  context, never from client input, and must not fall back to another tenant's data or credentials.

## Code style

- Match the surrounding code. Prefer clear naming over comments.
- No emojis in code, UI copy, emails or commit messages.
- Keep files under 500 lines.

## License of contributions

By submitting a contribution you agree that it is licensed under the same terms as the project
(`LICENSE`), and that you have the right to submit it.
