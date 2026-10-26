import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getEntity } from '@/lib/filters/registry'
import {
  MAX_QUERY_LENGTH,
  MAX_VIEWS_PER_PAGE,
  createSavedView,
  listSavedViews,
  viewQuery,
  writeScopeOf,
} from '@/lib/admin/saved-views'

export const dynamic = 'force-dynamic'

// Saved views of a registered list (?page=<entity key>): the list's read scope sees them,
// sharing one needs its write scope.
export async function GET(request: NextRequest) {
  const entity = getEntity(request.nextUrl.searchParams.get('page') || '')
  if (!entity) return NextResponse.json({ error: 'Unknown list' }, { status: 400 })
  const admin = await requireAdminScope(request, entity.scope)
  if (admin instanceof NextResponse) return admin
  try {
    const views = await listSavedViews(admin.adminId, entity.key)
    return NextResponse.json({ views, canShare: hasScope(admin.role, admin.scopes, writeScopeOf(entity)) })
  } catch (err) {
    console.error('[saved-views] list', err)
    return NextResponse.json({ error: 'Failed to load views' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const entity = getEntity(typeof body?.page === 'string' ? body.page : '')
  if (!entity) return NextResponse.json({ error: 'Unknown list' }, { status: 400 })
  const admin = await requireAdminScope(request, entity.scope)
  if (admin instanceof NextResponse) return admin

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 80) return NextResponse.json({ error: 'Name must be 1-80 characters' }, { status: 400 })
  const query = viewQuery(entity, typeof body.query === 'string' ? body.query : '')
  if (query.length > MAX_QUERY_LENGTH) return NextResponse.json({ error: 'Too many filters to save' }, { status: 400 })
  const isShared = body.isShared === true
  if (isShared && !hasScope(admin.role, admin.scopes, writeScopeOf(entity))) {
    return NextResponse.json({ error: 'Insufficient permissions to share' }, { status: 403 })
  }

  try {
    const view = await createSavedView(admin.adminId, entity.key, { name, query, isShared })
    if (view === 'limit') {
      return NextResponse.json({ error: `At most ${MAX_VIEWS_PER_PAGE} views per list` }, { status: 409 })
    }
    if (view === 'duplicate') return NextResponse.json({ error: 'A view with that name exists' }, { status: 409 })
    return NextResponse.json({ view }, { status: 201 })
  } catch (err) {
    console.error('[saved-views] create', err)
    return NextResponse.json({ error: 'Failed to save view' }, { status: 500 })
  }
}
