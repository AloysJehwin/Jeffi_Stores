// Per-admin draft locks: a draft belongs to the admin who started it until it is published or
// discarded. Pure SQL over a `{ query }` client so controller-service and document-service share it.
export * from './registry'
export * from './locks'
export * from './presence'

/** Request header carrying the lock epoch the tab last saw (fences a stale tab after a handover). */
export const DRAFT_LOCK_EPOCH_HEADER = 'x-draft-lock-epoch'

export function parseEpoch(v: string | null | undefined): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 ? n : null
}
