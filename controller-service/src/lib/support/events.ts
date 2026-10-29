import 'server-only'
import { publish, subscribe } from '@/lib/shared/pubsub'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import type { SupportEvent } from './types'

// Redis is shared across tenants, so the tenant is part of every channel name. A session channel
// feeds that chat's customer and admin streams; the inbox channel feeds every admin's inbox.

const sessionChannel = (tenantId: string | null, sessionId: string) => `support:${tenantId || 'platform'}:s:${sessionId}`
const inboxChannel = (tenantId: string | null) => `support:${tenantId || 'platform'}:inbox`

export async function publishSupportEvent(event: SupportEvent, tenantId?: string | null): Promise<void> {
  try {
    const tid = tenantId !== undefined ? tenantId : await resolveTenantId().catch(() => null)
    await Promise.all([publish(sessionChannel(tid, event.sessionId), event), publish(inboxChannel(tid), event)])
  } catch {
    /* realtime is best effort; clients poll with ?after= */
  }
}

export function subscribeSession(tenantId: string | null, sessionId: string, fn: (e: SupportEvent) => void): () => void {
  return subscribe<SupportEvent>(sessionChannel(tenantId, sessionId), fn)
}

export function subscribeInbox(tenantId: string | null, fn: (e: SupportEvent) => void): () => void {
  return subscribe<SupportEvent>(inboxChannel(tenantId), fn)
}
