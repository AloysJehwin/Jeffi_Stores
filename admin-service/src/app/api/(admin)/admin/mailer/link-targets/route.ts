import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { queryMany } from '@/lib/shared/db'

export const dynamic = 'force-dynamic'

// Storefront paths for a push link: products, categories and offers matching ?q=.
export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'mailer:read')
  if (admin instanceof NextResponse) return admin
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 80)
  if (q.length < 2) return NextResponse.json({ items: [] })
  const like = `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`
  const items = await queryMany<{ kind: string; label: string; path: string; image_url: string | null }>(
    `(SELECT 'Product' AS kind, p.name AS label, '/products/' || p.slug AS path,
             (SELECT COALESCE(pi.thumbnail_url, pi.image_url) FROM product_images pi WHERE pi.product_id = p.id
               ORDER BY pi.is_primary DESC, pi.display_order ASC LIMIT 1) AS image_url
        FROM products p WHERE p.is_active = true AND p.is_draft = false AND (p.name ILIKE $1 OR p.sku ILIKE $1)
       ORDER BY p.name LIMIT 6)
     UNION ALL
     (SELECT 'Category', c.name, '/categories/' || c.slug, c.image_url
        FROM categories c WHERE c.is_active IS NOT FALSE AND c.is_draft = false AND c.name ILIKE $1 ORDER BY c.name LIMIT 4)
     UNION ALL
     (SELECT 'Offer', o.title, '/products?offer=' || o.slug, o.image_url
        FROM product_offers o WHERE o.is_active = true AND (o.ends_at IS NULL OR o.ends_at > now()) AND o.title ILIKE $1
       ORDER BY o.display_order LIMIT 4)`,
    [like]
  )
  return NextResponse.json({ items })
}
