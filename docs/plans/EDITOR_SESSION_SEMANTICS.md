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
- Only the draft's lock holder writes it; everyone else sees it read-only (see Draft locks).

## Draft locks: one editor per draft

A draft belongs to one admin at a time. The lock is a row in `draft_locks`, keyed by `(resource_type, resource_id)`; the shared logic is `packages/draft-locks` (`@jeffi/draft-locks`), wrapped by `controller-service/src/lib/admin/draft-locks.ts` and `document-service/src/lib/draft-locks.ts`. Lockable types and their write scopes are the package registry (`DRAFT_RESOURCES`): products, brands, categories, coupons, review forms, suppliers, offers, campaigns, homepage, mailer messages, invoices, quotations, purchase orders, new POs and PO receipts.

### Ownership

- **Start / create** acquires the lock. A draft with no lock row is **unclaimed**: the first admin to open or write it claims it. A few types seed the lock from an owner hint on first read (`po_drafts.admin_id`, `quotations.created_by`, `email_campaigns.created_by`, …) when that admin is still active and can write.
- **The holder keeps it until the draft is published or discarded** (or finalized / sent / converted). Closing keeps the row as a tombstone for 7 days, so viewers read "Published by Priya".
- **Everyone else is read-only.** Edit pages render with the server's lock state (`initialDraftLock`): the banner names the holder, start time, last activity and live viewers, the form sits in a disabled fieldset, and Save / Publish / Cancel are hidden. View pages show "View draft (read-only) · Priya" instead of the start/edit action. Lists show an owner badge on draft rows.
- **Every draft write asserts the holder** inside the write's transaction (`withDraftWrite` / `assertHolder`). The lock row stays locked until commit, so a takeover waits for an in-flight save. A refusal is HTTP **423** `{ error, code: 'DRAFT_LOCKED' | 'DRAFT_LOCK_STALE', lock }`. Publish asserts and closes the lock in the same transaction. Discard needs the holder, or an owner role (audited as `discard_override`, holder notified).
- **No actor means no lock**: system writers (imports, crons, variant status) pass straight through.

### Handing a draft on

- **Hand over**: the holder picks an active admin who has the type's write scope. They become the holder and are notified; the old holder becomes read-only.
- **Release**: the holder lets go; the draft is unclaimed and anyone with the write scope may claim it.
- **Request access**: a read-only admin asks the holder (one notification per requester, rate-limited).
- **Take over**: administrator / super_admin only, with a required reason. The previous holder is notified with the reason, their next save gets 423, and their editor switches to read-only.
- **Owner gone**: deactivating or deleting an admin releases their drafts; changing their role or scopes releases the drafts whose write scope they lost (`releaseLocksOfAdmin`, `/api/admin/users/[id]`). A holder who is inactive or lost the scope is treated as absent: anyone with the scope can claim the draft.

### Fencing stale tabs: the epoch

Every owner change (claim, handover, release, takeover, close) bumps `draft_locks.epoch`. The editor sends the epoch it last saw as `x-draft-lock-epoch` on draft writes; a write whose epoch is out of date gets **423 `DRAFT_LOCK_STALE`**, even from the same admin. Two tabs of the same holder both edit; a tab that missed a handover is stopped at its next save. When autosave hits a 423 it stops retrying, switches to read-only and offers "Copy them" for the unsaved changes.

### Superseded editor sessions

Opening an editor session acquires the lock in the same transaction (423 if someone else holds it); viewers never open sessions. When the lock moves away (handover, takeover, claim from an absent holder, release), the losing admin's open sessions close as `superseded`. **Cancel restores the snapshot only for the current holder, and only for a session started after they acquired the lock.** A superseded session's Cancel restores nothing, so a late Cancel cannot overwrite the new holder's work.

### Realtime and housekeeping

- Lock changes go out on the admin event stream (`dl:<tenant>` pub/sub, plus a `draft_locks.updated_at` poll so changes arrive without Redis and from document-service). Editors open on a draft heartbeat presence every 20 s; a viewer drops out after 45 s without one.
- `/admin/drafts` lists drafts by tab: **Mine**, **All locked**, **Unclaimed**, with claim / release / hand over / take over where allowed.
- The 5-minute `cron/sweep-sessions` job deletes stale presence, closes locks whose draft no longer exists (`orphaned`), releases locks held by inactive admins, and deletes tombstones older than 7 days.

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
