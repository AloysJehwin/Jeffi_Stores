import { queryMany } from '@/lib/shared/db'
import { draftLockChips, type DraftLockChip } from './draft-locks'
import type { DraftAdapter } from './draft-branches'

/** List-row badges keyed by entity id, now that locks are per draft: one holder per entity, the viewer's own first. */
export async function entityDraftChips(a: DraftAdapter, entityIds: string[], me?: string | null): Promise<Record<string, DraftLockChip>> {
  if (!entityIds.length) return {}
  const drafts =
    (await queryMany<{ id: string; entity_id: string }>(
      `SELECT id, ${a.entityKey} AS entity_id FROM ${a.table} WHERE ${a.entityKey} = ANY($1::uuid[])`,
      [entityIds]
    )) ?? []
  if (!drafts.length) return {}
  const chips = await draftLockChips(a.type, drafts.map(d => d.id), me)
  const out: Record<string, DraftLockChip> = {}
  for (const d of drafts) {
    const c = chips[d.id]
    if (c && (!out[d.entity_id] || c.mine)) out[d.entity_id] = c
  }
  return out
}
