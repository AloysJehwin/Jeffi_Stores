import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { canUseAi } from '@/lib/auth/ai-scope'
import { findGoogleCategory, resolveCategoryGoogleCategory, searchGoogleTaxonomy } from '@/lib/catalog/google-taxonomy'

// GET ?q= searches the Google product taxonomy; ?value= checks a stored value.
export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const value = url.searchParams.get('value')
  if (value !== null) return NextResponse.json({ match: findGoogleCategory(value) })
  const q = (url.searchParams.get('q') || '').trim()
  return NextResponse.json({ results: q.length < 2 ? [] : searchGoogleTaxonomy(q, 20) })
}

// POST { name, description?, parent_id? } → the automatic match for a category.
export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'categories:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const body = await req.json().catch(() => ({}))
  const name = String(body?.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Enter a category name first' }, { status: 400 })
  const path = await resolveCategoryGoogleCategory(null, {
    name,
    description: body?.description || null,
    parentId: body?.parent_id || null,
    ai: canUseAi(admin.role, admin.scopes, 'categories:write'),
  })
  return NextResponse.json({ match: findGoogleCategory(path) })
}
