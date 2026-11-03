import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { DRAFT_RESOURCES, heartbeat, isDraftResourceType, viewers as listViewers } from '@jeffi/draft-locks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'
import { zUuid } from '@/lib/shared/validate'
import { getDraftLockState } from '@/lib/admin/draft-locks'
import { publishLockEvent } from '@/lib/admin/draft-lock-events'

export const dynamic = 'force-dynamic'

const db = { query: (t: string, p?: unknown[]) => query(t, p as any[]) }

const schema = z.object({
  resourceType: z.string(),
  resourceId: zUuid,
  tabId: z.string().min(4).max(64),
  mode: z.enum(['view', 'edit']).default('view'),
  leaving: z.boolean().optional(),
})

/**
 * Presence heartbeat from an open draft (every 20 s, on visibility change, and a sendBeacon with
 * `leaving` on pagehide). Display only and passive: it never extends the admin's idle window.
 */
export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req, { passive: true })
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // sendBeacon posts text/plain.
  const raw = await req.text().catch(() => '')
  let json: unknown = null
  try {
    json = JSON.parse(raw)
  } catch {
    /* invalid */
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success || !isDraftResourceType(parsed.data.resourceType))
    return NextResponse.json({ error: 'Invalid heartbeat' }, { status: 400 })
  const { resourceType: type, resourceId: id, tabId, mode, leaving } = parsed.data as typeof parsed.data & {
    resourceType: keyof typeof DRAFT_RESOURCES
  }
  if (!hasScope(admin.role, admin.scopes, DRAFT_RESOURCES[type].readScope))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { changed } = await heartbeat(db, { type, id, adminId: admin.adminId, tabId, mode, leaving })
  const viewers = await listViewers(db, type, id)
  if (changed) await publishLockEvent({ type: 'presence', resourceType: type, resourceId: id, lock: null, viewers, by: admin.adminId })
  if (leaving) return NextResponse.json({ ok: true })
  const state = await getDraftLockState(admin, type, id)
  return NextResponse.json({ ...state, me: admin.adminId, viewers })
}
