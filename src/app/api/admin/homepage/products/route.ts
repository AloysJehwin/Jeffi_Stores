import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { queryMany } from '@/lib/db'
import type { PickerProduct } from '@/lib/homepage-sections'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  q: z.string().trim().max(100).optional(),
  ids: z.string().optional().transform(s => (s ? s.split(',').filter(Boolean) : [])).pipe(z.array(z.guid()).max(50)),
})

const SELECT = `
  SELECT p.id, p.name, p.sku, p.is_bundle,
    (SELECT COALESCE(pi.thumbnail_url, pi.image_url) FROM product_images pi
      WHERE pi.product_id = p.id ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) AS image_url
  FROM products p`

/** Product lookup for the homepage section pickers: `ids` resolves saved picks, `q` searches name or SKU. */
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const sp = request.nextUrl.searchParams
  const parsed = querySchema.safeParse({ q: sp.get('q') ?? undefined, ids: sp.get('ids') ?? undefined })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { q, ids } = parsed.data

  if (ids.length > 0) {
    const rows = await queryMany<PickerProduct>(`${SELECT} WHERE p.id = ANY($1::uuid[])`, [ids])
    const byId = new Map(rows.map(r => [r.id, r]))
    return NextResponse.json({ products: ids.map(id => byId.get(id)).filter(Boolean) })
  }
  if (!q || q.length < 2) return NextResponse.json({ products: [] })

  const products = await queryMany<PickerProduct>(
    `${SELECT}
     WHERE p.is_active = true AND (p.name ILIKE $1 OR p.sku ILIKE $1)
     ORDER BY (p.name ILIKE $2) DESC, p.name ASC
     LIMIT 12`,
    [`%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`, `${q.replace(/[\\%_]/g, m => `\\${m}`)}%`],
  )
  return NextResponse.json({ products })
}
