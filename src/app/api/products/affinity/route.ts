import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { frequentlyBoughtWith, alsoViewedWith } from '@/lib/product-affinity'
import { getProductCardsByIds, cardPropsFor } from '@/lib/product-cards'
import { getFeatureFlags } from '@/lib/site-controls'

export const dynamic = 'force-dynamic'

const idList = (max: number) =>
  z.string().optional().transform(s => (s ? s.split(',').map(v => v.trim()).filter(Boolean) : []))
    .pipe(z.array(z.guid()).max(max))

const querySchema = z.object({
  kind: z.enum(['bought', 'viewed']),
  ids: idList(20).refine(ids => ids.length > 0, 'ids is required'),
  exclude: idList(50),
  limit: z.coerce.number().int().min(1).max(12).default(8),
})

/**
 * Public "frequently bought together" (kind=bought, any number of ids) and "customers also viewed"
 * (kind=viewed, first id) as ProductCard props. Only card fields leave the server, never raw rows.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const parsed = querySchema.safeParse({
    kind: sp.get('kind') ?? undefined,
    ids: sp.get('ids') ?? undefined,
    exclude: sp.get('exclude') ?? undefined,
    limit: sp.get('limit') ?? undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const { kind, ids, exclude, limit } = parsed.data

  try {
    const skip = new Set(exclude)
    const ranked = kind === 'bought'
      ? await frequentlyBoughtWith(ids, limit + skip.size)
      : await alsoViewedWith(ids[0], limit + skip.size)
    const wanted = ranked.filter(id => !skip.has(id)).slice(0, limit)
    const { gstEnabled } = await getFeatureFlags()
    const products = cardPropsFor(await getProductCardsByIds(wanted, gstEnabled), gstEnabled)
    return NextResponse.json({ products })
  } catch (err) {
    console.error('[products/affinity]', kind, err)
    return NextResponse.json({ products: [] })
  }
}
