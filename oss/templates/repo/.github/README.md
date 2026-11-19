<!-- Managed from %%upstream%% (oss/templates); edits here are overwritten by the next export. -->
<p align="center"><a href="https://github.com/%%org%%"><img src="https://raw.githubusercontent.com/%%org%%/.github/main/assets/jeffi-erp-logo.svg" width="64" alt="Jeffi ERP"></a></p>

# %%repo%%

%%description%%

Part of [Jeffi ERP](https://github.com/%%org%%), where the Jeffi Stores commerce platform is developed in the open. In the workspace this repo is %%folder%%. It builds and tests inside the assembled workspace, not on its own.

## Set up

```bash
git clone https://github.com/%%org%%/workspace.git jeffi-erp
cd jeffi-erp
node oss/assemble.mjs        # clones every Jeffi ERP repo into its folder
npm ci
cp .env.example .env.local   # then fill in what you need
```

To change this repo, fork it and add your fork as a remote inside %%folder%%. The full guide is in [CONTRIBUTING](https://github.com/%%org%%/.github/blob/main/CONTRIBUTING.md).

## How a change gets in

1. Open a pull request against `main`. Nothing runs yet.
2. A maintainer reads it and adds the `%%label%%` label. That runs **PR checks** and **Guard**. A new push removes the label until a maintainer looks again.
3. When both pass, a maintainer squash-merges it. The merge runs pre-build and build, then waits for a maintainer to approve the promotion.
4. After approval the change is opened as a pull request on [%%upstream%%](https://github.com/%%upstream%%) and ships with a later release. The export from that release brings it back here.

`.github/` and `LICENSE` (and `oss/` in workspace) come from %%upstream%%, and Guard rejects pull requests that change them. Open an issue for those instead.

## Checks

%%checks%%

Run a stage locally from the workspace root: `node oss/checks.mjs %%repo%% pr`.

## Licence

[Business Source License 1.1](../LICENSE). You may read, modify and make non-production use of this code. Production use needs a commercial licence from Jeffi Stores until the Change Date in the licence, when it becomes Apache-2.0. Contributions are accepted on the terms in [CONTRIBUTING](https://github.com/%%org%%/.github/blob/main/CONTRIBUTING.md).
