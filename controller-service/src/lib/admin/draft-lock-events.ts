import type { DraftLock, DraftResourceType, DraftViewer } from '@jeffi/draft-locks'
import { publish, subscribe } from '@/lib/shared/pubsub'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'

export type LockEventType = 'acquired' | 'released' | 'handover' | 'takeover' | 'closed' | 'presence'

export interface LockFrame {
  kind: 'lock'
  type: LockEventType
  resourceType: DraftResourceType
  resourceId: string
  lock: DraftLock | null
  viewers?: DraftViewer[]
  by: string | null
  reason?: string | null
  at: string
}

// Redis is shared across tenants, so the tenant is part of the channel name.
export function lockChannel(tenantId: string | null): string {
  return `dl:${tenantId || 'platform'}`
}

export async function publishLockEvent(frame: Omit<LockFrame, 'kind' | 'at'>, tenantId?: string | null): Promise<void> {
  try {
    const tid = tenantId !== undefined ? tenantId : await resolveTenantId().catch(() => null)
    await publish(lockChannel(tid), { kind: 'lock', at: new Date().toISOString(), ...frame } satisfies LockFrame)
  } catch {
    /* realtime is best effort; the SSE poll catches up */
  }
}

export function subscribeLockFrames(tenantId: string | null, handler: (frame: LockFrame) => void): () => void {
  return subscribe<LockFrame>(lockChannel(tenantId), handler)
}
