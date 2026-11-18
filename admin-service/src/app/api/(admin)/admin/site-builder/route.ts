import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { queryMany, queryOne } from '@/lib/shared/db'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { parsePageRefKey } from '@jeffi/site-blocks'
import { getPublishedPage, importLegacyLayouts, listSiteDrafts, setSiteBuilderEnabled, siteBuilderEnabled } from '@/lib/site/store'
import { afterSiteChange } from '@/lib/site/after-publish'
import { requireAdminScope } from '@/lib/auth/jwt'

export const dynamic = 'force-dynamic'

// GET: whether Site Builder renders the store, its published pages and open drafts; with ?key=<audience:surface:page:slug>,
// that page's published document; with ?theme=store|business, the published theme tokens.
// POST { setup: true }: bring today's homepage layouts in to edit (customers keep the Homepage builder).
// POST { enabled }: which builder is live. Turning Site Builder on first imports every layout that has no document yet.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:read')
  if (admin instanceof NextResponse) return admin
  // A product, category, brand, search word and order to preview their pages with.
  if (request.nextUrl.searchParams.get('sample')) {
    const [p, c, b, o] = await Promise.all([
      queryOne<{ slug: string; name: string | null }>(`SELECT slug, name FROM products WHERE is_active = true AND slug IS NOT NULL ORDER BY created_at DESC LIMIT 1`),
      queryOne<{ slug: string }>(`SELECT slug FROM categories WHERE is_active = true AND slug IS NOT NULL ORDER BY display_order NULLS LAST, name LIMIT 1`),
      queryOne<{ slug: string }>(`SELECT slug FROM brands WHERE is_active = true AND slug IS NOT NULL ORDER BY name LIMIT 1`).catch(() => null),
      queryOne<{ id: string }>(`SELECT id FROM orders ORDER BY created_at DESC LIMIT 1`).catch(() => null),
    ])
    const search = p?.name?.trim().split(/\s+/)[0] ?? null
    return NextResponse.json({ product: p?.slug ?? null, category: c?.slug ?? null, brand: b?.slug ?? null, search, order: o?.id ?? null })
  }
  const theme = request.nextUrl.searchParams.get('theme')
  if (theme) {
    const row = await queryOne<{ tokens: unknown }>(`SELECT tokens FROM site_theme WHERE audience = $1`, [theme === 'business' ? 'business' : 'store'])
    return NextResponse.json({ tokens: row?.tokens ?? null })
  }
  const key = request.nextUrl.searchParams.get('key')
  if (key) {
    const ref = parsePageRefKey(key)
    if (!ref) return NextResponse.json({ error: 'Unknown page' }, { status: 400 })
    const page = await getPublishedPage(ref)
    return page ? NextResponse.json(page) : NextResponse.json({ error: 'That page has no published document' }, { status: 404 })
  }
  const [enabled, pages, drafts] = await Promise.all([
    siteBuilderEnabled(),
    queryMany(`SELECT audience, surface, page_key, slug, version, published_at FROM site_pages ORDER BY audience, surface, page_key, slug`),
    listSiteDrafts(),
  ])
  return NextResponse.json({ enabled, pages, drafts })
}

const Body = z.union([z.object({ enabled: z.boolean() }), z.object({ setup: z.literal(true) })])

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Send { enabled: true | false } or { setup: true }' }, { status: 400 })
  // Set up: bring today's layouts over to edit, customers keep the Homepage builder. Enabled: make Site Builder live.
  if ('setup' in parsed.data) return NextResponse.json({ imported: await importLegacyLayouts(admin.adminId) })
  const imported = parsed.data.enabled ? await importLegacyLayouts(admin.adminId) : 0
  await setSiteBuilderEnabled(parsed.data.enabled)
  await afterSiteChange(request)
  await logAdminAudit({
    adminId: admin.adminId,
    action: 'update',
    entityType: 'site_builder',
    entityId: 'site',
    summary: parsed.data.enabled ? `Turned Site Builder on (${imported} layouts imported)` : 'Turned Site Builder off',
    request,
  }).catch(() => {})
  return NextResponse.json({ enabled: parsed.data.enabled, imported })
}
