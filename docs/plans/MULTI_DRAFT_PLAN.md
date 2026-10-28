# Multiple Drafts per Entity

Status: proposed
Date: 2026-10-28
Builds on: [EDITOR_SESSION_SEMANTICS.md](EDITOR_SESSION_SEMANTICS.md) (draft locks)

Today an entity has at most one draft (`product_drafts` etc. are keyed by the entity id) and the draft lock makes it single-editor. This plan lets several admins each hold their own draft of the same entity, and makes the second merge show what the first one changed.

## The problem to solve first: lost updates

A draft row stores the whole editor form, not a patch. Publish writes every column from it (`publishCategoryDraft` sets `description = $4` whether or not the admin touched it). So if live changes after a draft starts (another draft merged, a bulk import, a quick toggle on the list), publishing the older draft silently reverts those changes. This happens today with one draft; with several drafts it becomes the normal case. The merge below fixes it for both.

## Model

### Draft rows become branches

Each catalog draft table (`product_drafts`, `brand_drafts`, `category_drafts`, `coupon_drafts`, `review_form_drafts`, `supplier_drafts`, `offer_drafts`) gets:

| column | meaning |
|---|---|
| `id uuid` | new primary key (the old key, e.g. `product_id`, becomes a plain indexed column) |
| `author_admin_id uuid` | who started it |
| `base jsonb` | the live editable shape (same shape as the draft) captured when the draft was created |
| `base_revision int` | the entity's revision when the draft was created |
| `title text` | optional label ("Diwali price change") |

Existing rows migrate in place: `id = gen_random_uuid()`, `base = current live shape`, `base_revision = current revision`, `author = lock holder or hint`. A partial unique index is not added: several open drafts per entity is the point.

Document-type drafts (invoices, quotations, purchase orders, PO receipts, mailer messages) stay single: they are documents in a draft status, not overlays on a live row. The homepage draft stays a singleton for now (section arrays need their own merge; later phase).

### Revisions

New table `entity_revisions` (topic file `logs.sql`, PK/indexes in `constraints.sql` / `indexes.sql`):

| column | meaning |
|---|---|
| `resource_type, resource_id` | the entity |
| `revision int` | 1, 2, 3 … per entity |
| `draft_id uuid` | the draft that produced it (null for direct writes) |
| `actor_admin_id uuid`, `created_at` | who and when |
| `changes jsonb` | `{ path: { from, to } }` for every field the revision changed |

Every publish writes one row. Direct writes that bypass drafts (list toggles, bulk edit, imports, stock sync) write one too, through a shared `recordRevision()` helper, so the merge can name who changed a field and when.

### Locks move to the draft

The lock key becomes the draft id (`draft_locks.resource_id = <draft id>`), so each branch has one owner and the existing claim / hand over / request / take over flows apply per branch. Opening an entity no longer blocks a second admin; they get their own draft instead.

## Merge (publish) algorithm

For draft `D` with base `B`, against current live `L`:

1. **Mine** = paths where `D ≠ B` (what this admin changed).
2. **Theirs** = paths where `L ≠ B` (what landed on live since this draft started), each attributed from `entity_revisions` after `base_revision` (last writer wins for the label: "Priya, 2 h ago, via draft *Diwali price change*").
3. **Merged** = `L` overlaid with Mine. Fields this admin did not touch keep the newer live value; this is what removes the lost update.
4. **Conflicts** = Mine ∩ Theirs where `D ≠ L`. If empty, publish `Merged` directly. Otherwise return 409 `{ code: 'DRAFT_CONFLICT', conflicts: [{ path, label, base, theirs, theirsBy, theirsAt, mine }] }`.
5. The admin resolves each conflict (keep mine / take theirs / edit for text fields) in the merge dialog, which re-submits with `resolutions`. The server re-runs 1–4 against the newest live in the publish transaction (`SELECT … FOR UPDATE` on the entity row), so a third merge landing meanwhile shows up instead of being overwritten.
6. On success: write live, write the revision, close the draft (`merged`), and notify the other open drafts of that entity: "Priya merged *Diwali price change* — 2 of your fields now differ from live". Their editors show a "Live moved since you started" chip with a link to preview the diff.

Paths: scalar fields are top-level keys. Array sections (product variants, images, units, offer products) are keyed by element id, so `variants[<id>].price` conflicts only when both sides changed the same variant's price; an element deleted on one side and edited on the other is a conflict of its own ("Priya removed this variant").

## UI

- **Edit page**: opening `/edit` on an entity with drafts shows a picker: *Continue your draft*, *Start a new draft*, or *View* another admin's draft (read-only). The bottom bar's publish button becomes **Merge**; with conflicts it opens the merge dialog.
- **Merge dialog**: one row per conflict, three columns (when you started · now on live, with who and when · yours), a radio per row, "Keep all mine" / "Take all theirs" shortcuts, and a collapsed list of the non-conflicting changes from others that will be kept.
- **Drafts tab** (now on every list page): rows grouped by entity, with a "2 drafts" badge and a "behind live" chip on drafts whose `base_revision` is old.
- **Entity history**: the revisions table feeds the existing entity timeline (`ENTITY_TIMELINE_PLAN.md`) with field-level diffs.

## Phases

1. **Revisions + three-way publish on today's single drafts.** Add `base`, `base_revision`, `entity_revisions`, `recordRevision()` on direct writes, and the merge algorithm in each `publish*Draft`. This alone fixes lost updates and gives "changed by" attribution, with no change to how many drafts exist.
2. **Multiple drafts for catalog types.** New draft PK, lock per draft id, edit-page picker, merge dialog, notifications to sibling drafts. Products last (variants/images arrays).
3. **Homepage sections** if needed.

Each phase is schema-pipeline DDL (topic file + `constraints.sql` + `indexes.sql`), applied locally first; no hand-written migrations except the data backfill of existing draft rows, which goes in `database/migrations/` as the pipeline expects for data.

## Open questions

- Should a merge be allowed while another admin's draft of the same entity is mid-autosave? (Proposed: yes; their next save sees the moved base.)
- Who may merge someone else's draft? (Proposed: only its holder, or an owner via takeover, same as publish today.)
- Retention for merged/discarded drafts (proposed: 30 days, then deleted by `cron/sweep-sessions`).
