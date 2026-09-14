# Releasing

Versions are `MAJOR.MINOR.PATCH`, starting at `1.0.0`. The version is derived from
commit messages; you approve it before anything is tagged.

## How it works

```
commits land on main
        |
  Release Please opens / updates ONE PR:  "chore(release): 1.1.0"
    - bumps package.json
    - writes CHANGELOG.md
        |
  you review the version + changelog in the PR diff
        |
      merge
        |
  tag v1.1.0  +  GitHub Release published
```

Nothing is tagged until you merge. If no releasable commits have landed, no PR appears.

## What sets the version

The **PR title** is what matters — this repo squash-merges, so the title becomes the
commit subject on `main`.

| PR title starts with | Bump | 1.0.0 becomes |
|---|---|---|
| `fix:` | patch | 1.0.1 |
| `feat:` | minor | 1.1.0 |
| `feat!:` / `BREAKING CHANGE:` in body | major | 2.0.0 |
| `chore:` `docs:` `test:` `ci:` `build:` | none | no release |

Scopes are free-form: `fix(tenant):`, `fix(scopes,oauth):` both work.

The highest bump in the range wins — one `feat:` among ten `fix:` gives a minor.

## Cutting a release

1. Merge work to `main` as usual.
2. A release PR appears (or updates) within a minute.
3. Check the proposed version and changelog.
4. Merge it. The tag and GitHub Release are created automatically.

## Forcing a major

Put a breaking-change footer in the commit body:

```
feat(api)!: drop legacy order payload

BREAKING CHANGE: /api/orders no longer accepts the v1 shape.
```

## Fixing a wrong version

The release PR is regenerated from commits — don't hand-edit it. Instead fix the
source: amend the offending commit's message (if unpushed), or land a follow-up
with the right prefix. The PR updates itself.

## When no release PR appears

- Every commit since the last tag was `chore:`/`docs:`/`ci:` — nothing to release
- A PR title was malformed, so its squashed commit isn't recognised — check the
  "PR Title" workflow on that PR

## When the release PR won't merge

If required checks show "Expected — Waiting for status" and never run, the
`RELEASE_TOKEN` secret is missing or expired. A PR opened with the default token
does not trigger CI. Re-create the secret and close/reopen the PR.

## Files you should not hand-edit

- `CHANGELOG.md` — generated
- `package.json` `version` — bumped by the release PR
- `.github/.release-please-manifest.json` — tracks the current version
