# Releasing

Versions are `MAJOR.MINOR.PATCH`. Every push to `main` tags the next version and publishes a
GitHub Release automatically (`.github/workflows/release.yml`). There is no release PR to merge.

## How it works

```
PR merged to main
        |
  release.yml reads the commits since the last v* tag
        |
  highest bump wins  ->  tag vX.Y.Z on that commit + GitHub Release with grouped notes
```

If nothing release-worthy landed, no tag is made.

## What sets the version

Each commit's subject (merges are skipped, so the commits on the branch count):

| Commit starts with | Bump | 1.3.0 becomes |
|---|---|---|
| `fix:` `perf:` | patch | 1.3.1 |
| `feat:` | minor | 1.4.0 |
| `feat!:` / `BREAKING CHANGE:` in body | major | 2.0.0 |
| `refactor:` `revert:` `chore:` `docs:` `test:` `ci:` `build:` | none | no release |

Scopes are free-form: `fix(tenant):`, `fix(scopes,oauth):` both work. One `feat:` among ten `fix:`
gives a minor. Keep PR titles in the same format; the "PR Title" check flags ones that aren't.

## Forcing a major

Put a breaking-change footer in the commit body:

```
feat(api)!: drop legacy order payload

BREAKING CHANGE: /api/orders no longer accepts the v1 shape.
```

## Fixing a wrong version

Delete the tag and its release (`gh release delete vX.Y.Z --cleanup-tag`), land a follow-up commit
with the right prefix, or tag by hand: `gh release create vX.Y.Z --target <sha> --generate-notes`.
To re-run the release for the current `main`: Actions → Release → Run workflow.

## Notes

- The release notes live on the GitHub Release. `CHANGELOG.md` holds history up to v1.2.0 and is
  no longer updated; `package.json` `version` is not bumped (the tag is the version).
- Deploys are separate: the pipeline (`ci.yml`) deploys every push to `main` after approval.
