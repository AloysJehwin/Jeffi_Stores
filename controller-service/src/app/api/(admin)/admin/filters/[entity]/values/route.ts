import { NextRequest, NextResponse } from 'next/server'
import { isValuesField, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getEntity } from '@/lib/filters/registry'
import { getFilterValues } from '@/lib/filters/run'
import { withDefaultWindow } from '@/lib/filters/window'

export const dynamic = 'force-dynamic'

// Value help for any registered list: ?field=&search=&page=&context=<the list's other filters>.
export async function GET(request: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const entity = getEntity((await params).entity)
  if (!entity) return NextResponse.json({ error: 'Unknown list' }, { status: 404 })
  const admin = await requireAdminScope(request, entity.scope)
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  const field = sp.get('field') || ''
  if (!isValuesField(entity, field)) return NextResponse.json({ error: 'Invalid field' }, { status: 400 })
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1)
  const q = withDefaultWindow(entity, normalizeQuery(entity, new URLSearchParams(sp.get('context') || '')))
  try {
    const res = await getFilterValues(entity, field, q, { search: sp.get('search') || '', page })
    return NextResponse.json({ field, page, ...res })
  } catch (err) {
    console.error(`[filters/${entity.key}/values]`, err)
    return NextResponse.json({ error: 'Failed to load values' }, { status: 500 })
  }
}
