import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getEntity } from '@/lib/filters/registry'
import {
  MAX_QUERY_LENGTH,
  deleteSavedView,
  getOwnView,
  updateSavedView,
  viewQuery,
  writeScopeOf,
} from '@/lib/admin/saved-views'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const notFound = () => NextResponse.json({ error: 'View not found' }, { status: 404 })

/** The admin's own view and its list, or the response to return: other admins' views are 404. */
async function ownView(request: NextRequest, id: string) {
  const admin = await requireAdminScope(request, null)
  if (admin instanceof NextResponse) return admin
  if (!UUID_RE.test(id)) return notFound()
  const view = await getOwnView(admin.adminId, id)
  const entity = view && getEntity(view.pageKey)
  if (!view || !entity) return notFound()
  if (!hasScope(admin.role, admin.scopes, entity.scope)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return { admin, view, entity }
}

// Rename, update to the current filters, share / unshare (sharing needs the list's write scope).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const own = await ownView(request, (await params).id)
    if (own instanceof NextResponse) return own
    const { admin, view, entity } = own
    const body = await request.json().catch(() => ({}))

    const patch: { name?: string; query?: string; isShared?: boolean } = {}
    if (typeof body.name === 'string') {
      patch.name = body.name.trim()
      if (!patch.name || patch.name.length > 80) {
        return NextResponse.json({ error: 'Name must be 1-80 characters' }, { status: 400 })
      }
    }
    if (typeof body.query === 'string') {
      patch.query = viewQuery(entity, body.query)
      if (patch.query.length > MAX_QUERY_LENGTH) {
        return NextResponse.json({ error: 'Too many filters to save' }, { status: 400 })
      }
    }
    if (typeof body.isShared === 'boolean') patch.isShared = body.isShared
    // Editing a shared view changes what other admins see, so it needs the write scope too.
    if ((patch.isShared ?? view.isShared) && !hasScope(admin.role, admin.scopes, writeScopeOf(entity))) {
      return NextResponse.json({ error: 'Insufficient permissions to share' }, { status: 403 })
    }

    const updated = await updateSavedView(admin.adminId, view.id, patch)
    if (updated === 'duplicate') return NextResponse.json({ error: 'A view with that name exists' }, { status: 409 })
    return updated ? NextResponse.json({ view: updated }) : notFound()
  } catch (err) {
    console.error('[saved-views] update', err)
    return NextResponse.json({ error: 'Failed to update view' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const own = await ownView(request, (await params).id)
    if (own instanceof NextResponse) return own
    return (await deleteSavedView(own.admin.adminId, own.view.id)) ? NextResponse.json({ ok: true }) : notFound()
  } catch (err) {
    console.error('[saved-views] delete', err)
    return NextResponse.json({ error: 'Failed to delete view' }, { status: 500 })
  }
}
