import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryMany } from '@/lib/shared/db'
import { storeBaseUrlAsync } from '@/lib/catalog/brand'

export const dynamic = 'force-dynamic'

// Products for an email's product block: name, link, image and price as the email shows them.
export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['mailer:write', 'campaigns:write', 'templates:write'].some(s => hasScope(admin.role, admin.scopes, s)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const q = (req.nextUrl.searchParams.get('q') || '').trim()
  if (q.length < 2) return NextResponse.json({ items: [] })
  const rows = await queryMany<{ name: string; slug: string; price: string | null; mrp: string | null; image: string | null }>(
    `SELECT p.name, p.slug, COALESCE(pv.price, p.base_price)::text AS price, p.mrp::text AS mrp, pi.image_url AS image
       FROM products p
       LEFT JOIN LATERAL (SELECT MIN(price) AS price FROM product_variants WHERE product_id = p.id AND is_active = true) pv ON true
       LEFT JOIN LATERAL (SELECT image_url FROM product_images WHERE product_id = p.id ORDER BY is_primary DESC, display_order LIMIT 1) pi ON true
      WHERE p.is_active = true AND p.is_draft = false AND (p.name ILIKE $1 OR p.sku ILIKE $1)
      ORDER BY p.name LIMIT 12`,
    [`%${q}%`]
  )
  const base = (await storeBaseUrlAsync()).replace(/\/+$/, '')
  const fmt = (v: string | null) => (v == null || v === '' ? null : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 }))
  return NextResponse.json({
    items: rows.map(r => ({ name: r.name, url: `${base}/products/${r.slug}`, image: r.image, price: fmt(r.price), mrp: fmt(r.mrp) })),
  })
}
