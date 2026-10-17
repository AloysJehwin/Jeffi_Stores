# Editor Session Semantics

Status: proposed
Date: 2026-10-18
Scope: admin editor pages (products first, then suppliers, brands, categories, coupons, review forms, and any editor that gains a draft)

A single, shared contract for how admin editor pages treat drafts, snapshots, cancel and publish. The UI side of this contract is the kit `FormFooter` (bottom-bar card). Every editor renders exactly one `FormFooter`; the page header stays actionless.

## States

Each editable entity carries three logical states at edit time:

- **Live** — the public row (`products`, `brands`, …). Never written in-session on an existing entity.
- **Draft** — the unpublished working copy (`product_drafts`, `brand_drafts`, …). Autosaved by the editor. Deleted on publish or discard.
- **Snapshot** — a point-in-time copy of the draft held on the editor-session row (`editor_sessions.snapshot`). Taken when the session opens and again on every explicit Save-as-Draft. Cancel reverts the draft to this snapshot.

Snapshots are server-side so a failed autosave or a browser crash can never corrupt them.

## Session actions

Named operations the editor can invoke:

- **Open `/edit`** — the server opens (or resumes) an editor-session row; `snapshot <- current draft`. Opening a page that has no draft redirects to the view page (already in place).
- **Autosave** — field changes, toggles, line edits write to the draft only. Snapshot is untouched.
- **Save as Draft** — flush any pending autosave; **snapshot <- draft** (resnapshot); keep the session open. This is the only in-session action that moves the snapshot.
- **Update & Publish** — flush autosave; apply draft -> live per the entity's publish rules (products also purge inactive variants and sub-variants); delete the draft; close the session; redirect to view.
- **Discard draft** — delete the whole draft; close the session; redirect to view.
- **Cancel session** — block further autosaves, wait for in-flight; restore the draft from the snapshot; close the session; redirect to view.
- **Leave and return** — navigating away without pressing anything leaves the session open. The next open resumes the same session with the same snapshot. Cancel still reverts to the point this session started (unless a Save as Draft moved the snapshot since).

### Cancel example (user's A1 -> A2 -> A3 -> Cancel -> A2)

1. A1 is the stored draft before editing.
2. Open `/edit`: `snapshot = A1`.
3. User edits -> autosaved as A1'. Snapshot still A1.
4. User clicks Save as Draft -> draft is A2, `snapshot = A2`.
5. User edits more -> autosaved as A3. Snapshot still A2.
6. User clicks Cancel -> draft is restored to A2, session closes.

Discard at any step deletes the draft regardless of snapshot.

## Rules

- Autosave never moves the snapshot.
- Save as Draft is the only in-session action that resnapshots.
- Cancel reverts only the current session, not an earlier one.
- The snapshot lives on the server (per editor-session row) and survives client crashes.
- Discard removes the whole draft regardless of snapshot and closes the session.
- Publish is final; no session afterwards.

## UI: the shared `FormFooter` bottom bar

Every editor renders exactly one `FormFooter` at the bottom of the form. There is no top-of-form chrome, no banner, no secondary Cancel button. The page header carries only title + description + badges.

**This exact bottom-bar card is the single, shared pattern for every admin editor going forward.** The rollout order below migrates the existing editors to this one card; new editors use it from day one, not a bespoke row.

Reading order inside the one card (32px, `h-control`, kit tokens, light + dark):

```
[AutosaveStatusPill  Draft pending badge  banner  Restore] <spacer> [Discard | Cancel | Save as Draft | Update & Publish]
```

- **AutosaveStatusPill** — rendered by the pill component itself only when the autosave status is non-idle. Hidden by default.
- **Draft pending badge** — small badge when a draft exists for this entity.
- **Banner** — one-line notice. Today only one case: `"A newer local autosave exists."` when a local autosave is newer than the server draft. Otherwise none.
- **Restore** — accent ghost, shown beside the banner when a local autosave is newer than the server draft.
- **Discard** — ghost, confirms, shown only when there is a draft.
- **Cancel** — ghost, confirms, shown only when the session is open. Calls `edit.cancel()`, waits for the server rollback, then redirects to view.
- **Save as Draft** — secondary dark button, `name="intent" value="draft"`.
- **Update & Publish** — primary accent button, `name="intent" value="publish"`.

The look is one wide card (`rounded-xl border bg-surface-elevated`) that groups left-info and right-actions. Button order and tones are the same across every editor (Cancel ghost, Save as Draft secondary dark, Update & Publish primary accent).

### What the header does not have

No Cancel button at the top. No autosave pill at the top. No draft notice banner at the top. The old `EditSessionActions` row above the tabs is removed from editors that have migrated to the shared bar. The page header carries title + description + "Draft pending" badge only.

## Rollout order

1. Products (biggest; this pass).
2. Suppliers.
3. Brands.
4. Categories.
5. Coupons.
6. Review forms.
7. Any other editor that gains a draft follows this spec and reuses the same `FormFooter` directly — no reimplementation.

Until an editor is migrated, it continues to use `EditSessionActions`. Both components can coexist in the kit during the rollout.
