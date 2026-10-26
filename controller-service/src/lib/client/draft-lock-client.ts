// Browser-side draft-lock plumbing shared by editors: the epoch fence header and 423 errors.

export const DRAFT_LOCK_EPOCH_HEADER = 'x-draft-lock-epoch'

export interface DraftLockView {
  resourceType: string
  resourceId: string
  ownerId: string | null
  ownerName: string | null
  ownerActive: boolean
  ownerCanEdit: boolean
  previousOwnerId: string | null
  previousOwnerName: string | null
  via: 'start' | 'claim' | 'handover' | 'takeover' | 'backfill'
  reason: string | null
  epoch: number
  startedAt: string
  acquiredAt: string
  lastActiveAt: string
  updatedAt: string
  closedAt: string | null
  closedReason: string | null
  closedById: string | null
  closedByName: string | null
}

export interface DraftLockState {
  lock: DraftLockView | null
  draftExists: boolean
  isMine: boolean
  canEdit: boolean
  canTakeOver: boolean
  canDiscard: boolean
}

const epochs = new Map<string, number>()

export function setLockEpoch(type: string, id: string, epoch: number | null) {
  const k = `${type}:${id}`
  if (epoch == null) epochs.delete(k)
  else epochs.set(k, epoch)
}

/** Send with every draft write so a tab that lost the lock is fenced (423 DRAFT_LOCK_STALE). */
export function lockHeaders(type: string, id: string | null | undefined): Record<string, string> {
  const e = id ? epochs.get(`${type}:${id}`) : undefined
  return e == null ? {} : { [DRAFT_LOCK_EPOCH_HEADER]: String(e) }
}

export class DraftLockedError extends Error {
  readonly status = 423
  constructor(
    message: string,
    readonly code: string,
    readonly lock: Partial<DraftLockView> | null
  ) {
    super(message)
    this.name = 'DraftLockedError'
  }
}

export function isDraftLockedError(e: unknown): e is DraftLockedError {
  return !!e && typeof e === 'object' && ((e as { status?: number }).status === 423 || (e as { name?: string }).name === 'DraftLockedError')
}

/** Throw on a non-2xx response: DraftLockedError for 423, a plain Error otherwise. */
export async function assertDraftResponse(res: Response, fallback = 'Save failed'): Promise<void> {
  if (res.ok) return
  const body = await res.json().catch(() => ({}))
  if (res.status === 423) throw new DraftLockedError(body.error || 'Someone else is editing this draft', body.code || 'DRAFT_LOCKED', body.lock ?? null)
  throw new Error(body.error || fallback)
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
