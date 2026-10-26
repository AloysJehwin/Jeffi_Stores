import { NextRequest, NextResponse } from 'next/server'
import { DRAFT_RESOURCES, DRAFT_RESOURCE_TYPES, isDraftResourceType, listDrafts, viewerCounts } from '@jeffi/draft-locks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope, isPlatformOwner } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50
const db = { query: (t: string, p?: unknown[]) => query(t, p as any[]) }

/** Drafts dashboard: ?scope=mine|all|unclaimed&type=&page=, limited to the types the caller can read. */
export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req, { passive: true })
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const sp = req.nextUrl.searchParams
  const scope = sp.get('scope') === 'all' ? 'all' : sp.get('scope') === 'unclaimed' ? 'unclaimed' : 'mine'
  const want = sp.get('type')
  const types = DRAFT_RESOURCE_TYPES.filter(
    t => (!want || want === t) && hasScope(admin.role, admin.scopes, DRAFT_RESOURCES[t].readScope)
  )
  if (want && !isDraftResourceType(want)) return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
  const { rows, total } = await listDrafts(db, {
    scope,
    adminId: admin.adminId,
    types,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    hasScope,
  })
  const counts = await viewerCounts(db, rows.map(r => ({ type: r.resourceType, id: r.resourceId })))
  const owner = isPlatformOwner(admin.role)
  return NextResponse.json({
    page,
    pageSize: PAGE_SIZE,
    total,
    types,
    items: rows.map(r => {
      const writer = hasScope(admin.role, admin.scopes, DRAFT_RESOURCES[r.resourceType].writeScope)
      const held = !!r.lock?.ownerId && r.lock.ownerCanEdit
      return {
        ...r,
        typeLabel: DRAFT_RESOURCES[r.resourceType].label,
        viewers: counts[`${r.resourceType}:${r.resourceId}`] ?? 0,
        isMine: r.lock?.ownerId === admin.adminId,
        canClaim: writer && !held,
        canTakeOver: writer && owner && held && r.lock?.ownerId !== admin.adminId,
      }
    }),
  })
}
