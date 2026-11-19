# Jeffi ERP: the open-source mirror

Jeffi_Stores stays the source of truth. Each service is exported to its own public repo in the
[Jeffi-ERP](https://github.com/Jeffi-ERP) org, where people contribute. A merged contribution comes back here as a
pull request on `main` only after a maintainer approves it.

```
Jeffi_Stores main ──push──▶ OSS export (this repo) ──▶ Jeffi-ERP/<repo> main     (commit with "Upstream-Commit:")
                                                         ▲
contributor fork ──PR──▶ Jeffi-ERP/<repo> ──ok-to-test──▶ PR checks + Guard ──maintainer merges──┐
                                                                                                 ▼
Jeffi_Stores ◀──PR into main (OSS-Source:)── approval (promote env) ◀── build ◀── pre-build ◀── Merge pipeline
```

## Files

| Path | What it is |
|---|---|
| `oss/repos.json` | Repo map: which Jeffi_Stores paths go to which org repo, what's left out, each repo's checks, the app IDs |
| `oss/export.mjs` | The export. `--init` made each repo's first commit; without it, applies what changed since the last export |
| `oss/templates/repo/` | Rendered into every org repo: the three workflows, CODEOWNERS, README (`.github/`) |
| `oss/templates/org/` | The org's `.github` repo: profile, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT, GOVERNANCE, templates, logo |
| `oss/workspace/` | `assemble.mjs`, `checks.mjs`, `promote.mjs`, copied into `Jeffi-ERP/workspace/oss/` |
| `oss/configure.mjs` | Applies repo settings, labels, rulesets, environments, the team and the org profile (`gh` login) |
| `oss/create-apps.mjs` | Creates either GitHub App from a manifest and stores its ID and key (you run it) |
| `oss/setup-secrets.sh` | Stores the ID and key of an app made by hand (you run it) |
| `oss/secret-scan-allow.txt` | Reviewed trufflehog false positives |
| `.github/workflows/oss-export.yml` | Runs the export on every push to `main` |

Never exported: `deploy/` (except `deploy/load-secrets.mjs`, which `npm run dev` needs), this repo's `.github/`,
`docs/`, `graphify-out/`, `.claude/`, `CLAUDE.md`, `oss/` itself, the docker-compose files, root scripts other than the
build and test ones, `ai-platform/deploy/` (Razer box and Tailscale addresses),
`mobile-service/client/google-services.json` (Firebase key), and three store-core tests that hold real-looking
personal data (`razorpay-route-payload`, `shipping/courier-consignee`, `showcase-complete`).

## How it stays safe

- **No CI until a maintainer looks.** PR checks run only on the `ok-to-test` label (only triage+ users can add
  labels). A new push drops the label. Fork PRs run with a read-only token and no secrets, and the repos also
  require approval before any outside contributor's workflow runs.
- **Workflows can't be changed by a PR.** "Guard" runs from `main`'s copy of `pr-gate.yml`
  (`pull_request_target`, no checkout of PR code) and fails if a PR touches `.github/`, `LICENSE` or (in
  workspace) `oss/`. Both "PR checks" and "Guard" are required, and both exist only on `ok-to-test` runs, so a
  skipped job can't satisfy them.
- **Only you and the maintainers team merge.** Ruleset "Merge gate" restricts updates to `main` to those two
  (through a PR) and the export app. Ruleset "Required checks" needs a PR, the two checks and squash merges, with
  no bypass except the export app.
- **The Jeffi_Stores token appears only after approval.** It's a secret of the `promote` environment (required
  reviewers: you and maintainers; `main` only), used by the last job of the merge pipeline.
- **No loops.** Export commits carry `Upstream-Commit:` and the merge pipeline skips them. Promotions carry
  `OSS-Source:`, and when a promoted change comes back the export finds it already there and records a no-op.
- **No lost contributions.** Exports apply 3-way on top of the org repo. If upstream changes the same lines as a
  merged-but-unpromoted contribution, that repo's export stops and opens a `sync-conflict` issue.
- **Secret scan on every export.** trufflehog scans every file that changes; any finding not in
  `secret-scan-allow.txt` stops that repo's export.

## Steps only you can do

1. **Give the gh CLI org admin rights**: `gh auth refresh -h github.com -s admin:org`. Then run
   `node oss/configure.mjs team` (creates `maintainers`, Maintain on every repo) and `node oss/configure.mjs org`
   (org name, description and site; members can't create repos, teams or pages). Done on 2026-11-19.
2. **Org avatar**: upload `assets/jeffi-erp-logo.png` from the `Jeffi-ERP/.github` repo at
   https://github.com/organizations/Jeffi-ERP/settings/profile.
3. **Create the two GitHub Apps**, in your own terminal (each opens GitHub's "Create GitHub App" page filled in;
   click **Create GitHub App**, then **Install** on the page it moves to):
   ```bash
   node oss/create-apps.mjs export    # org-owned; install on Jeffi-ERP, "All repositories"
   node oss/create-apps.mjs promote   # yours; install on your account, "Only select repositories" → Jeffi_Stores
   ```
   Each stores its app's ID and private key in the right environments (oss-export on Jeffi_Stores, promote on every
   org repo) and records the ID in `oss/repos.json`. The key never touches disk. To create an app by hand instead,
   give it the permissions in `oss/create-apps.mjs`, download its key, and run
   `bash oss/setup-secrets.sh export|promote <App ID> <key.pem>`.
4. Optional, in org Settings → Member privileges: turn off **Repository deletion and transfer** and **Repository
   visibility change** for members (the API can't set these; members only have Maintain, which can do neither).
5. After step 3, run `node oss/configure.mjs protect` (adds the export app to the rulesets' bypass list).
6. **Merge the Jeffi_Stores change that adds `oss/` and this workflow.** Until it's on `main`, nothing exports
   automatically. After it's merged, check the first **OSS export** run in Actions.
7. Recommended: org Settings → Authentication security → **Require two-factor authentication**, and have a lawyer
   read the contributor licence grant in `CONTRIBUTING.md` (BSL 1.1 plus the right to relicense).

## Day to day

- **A PR arrives**: read the diff, then add `ok-to-test`. After a new push, look again and re-add it.
- **Merge**: squash-merge once "PR checks" and "Guard" pass. The merge pipeline runs pre-build and build, then
  waits. Approve it at the run's **Review deployments** (environment `promote`).
- **Promotion**: a PR opens on Jeffi_Stores `main` (branch `oss/<repo>/pr-<n>`, conventional title, `OSS-Source:`).
  Merging it releases to production after the `production` approval, like any PR into `main`. Afterwards merge
  `main` back into `feat/feature-release`.
- **Export conflicts**: a `sync-conflict` issue in the org repo lists the files. Promote or resolve the pending
  change, then Actions → **OSS export** → Run workflow.
- **A blocked export**: the run's summary names the detector and file. Remove the secret in Jeffi_Stores (and
  rotate it), or add a reviewed line to `oss/secret-scan-allow.txt`.
- **Changing the mirror**: edit `oss/repos.json` (paths, exclusions, checks) or `oss/templates/`; the next export
  applies it. Run `node oss/export.mjs --dry-run --upstream origin/main` (with `GH_TOKEN` set) to preview.
- **Adding a maintainer**: add them to the `maintainers` team (Maintain on every repo, merge rights through the
  ruleset, approver of promotions).
