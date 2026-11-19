# Governance

Jeffi Stores owns the code, the upstream repository ([AloysJehwin/Jeffi_Stores](https://github.com/AloysJehwin/Jeffi_Stores)) and the releases, and runs the Jeffi ERP org.

## Roles

**Owner.** Jeffi Stores, through the org owner account. The owner sets the direction, manages the org and its settings, merges promoted changes upstream and cuts releases, decides licensing and security matters, appoints maintainers, and has the final say when maintainers disagree. The owner can do everything a maintainer can.

**Maintainers.** Members of the `maintainers` team. They triage issues and discussions, review pull requests, add the `ok-to-test` label, merge pull requests once the checks pass, and approve the pipeline stage that sends a merged change upstream.

**Contributors.** Anyone who opens an issue, a discussion or a pull request, following [CONTRIBUTING.md](https://github.com/Jeffi-ERP/.github/blob/main/CONTRIBUTING.md) and the [Code of Conduct](https://github.com/Jeffi-ERP/.github/blob/main/CODE_OF_CONDUCT.md).

| Action | Owner | Maintainers | Contributors |
| --- | --- | --- | --- |
| Open issues, discussions and pull requests | Yes | Yes | Yes |
| Add or remove `ok-to-test` | Yes | Yes | No |
| Merge a pull request (checks must pass) | Yes | Yes | No |
| Approve the promotion to Jeffi_Stores | Yes | Yes | No |
| Merge upstream and release | Yes | No | No |
| Change managed files and these policies | Yes, upstream | No | No |
| Appoint or remove maintainers | Yes | No | No |

## Becoming a maintainer

The owner invites maintainers, and existing maintainers can suggest people. What counts is a record of good pull requests and reviews, sound judgement about what is safe to run in CI, and following the Code of Conduct. Maintainers need two-factor authentication on their GitHub account.

A maintainer can step down at any time. The owner can remove maintainer access, for example after a long period of inactivity or a Code of Conduct breach.

## How decisions are made

- Day-to-day decisions happen in issues and pull requests.
- Larger changes (new features, new dependencies, schema changes, changes across repositories) start with an issue or a discussion, so the approach is agreed before code is written.
- Maintainers aim for agreement. If they can't reach it, the owner decides.
- Licensing, security and releases are the owner's call. Managed files (`.github/`, `LICENSE`, `oss/`) and these policies are changed in the upstream repository; propose changes in an issue.
