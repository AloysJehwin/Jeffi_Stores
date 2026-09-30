import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { authenticateUser } from '@/lib/jwt'
import { getFeaturedForUser, getBestSellerCards, type RecCard } from '@/lib/recommendations'

export const dynamic = 'force-dynamic'

// Map a hydrated product row to the exact ProductCard prop shape the homepage
// uses (mirrors productCardProps() in src/app/page.tsx) so the client stays thin
// and cards render identically to the rest of the homepage.
function toCardProps(p: RecCard) {
  const primaryImage = p.product_images?.find(i => i.is_primary) || p.product_images?.[0] || null
  const hasVariants = p.has_variants
  const displayPrice = hasVariants && p.variant_min_price != null ? Number(p.variant_min_price) : Number(p.base_price)
  const effectiveStock = hasVariants ? Number(p.variant_stock_total ?? 0) : p.stock_status !== 'Out of Stock' ? 1 : 0
  const mrp = p.mrp ? Number(p.mrp) : p.variant_min_mrp ? Number(p.variant_min_mrp) : null
  const mrpDiscount = mrp && mrp > displayPrice ? Math.round(((mrp - displayPrice) / mrp) * 100) : 0
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    hasVariants,
    displayPrice,
    mrp,
    mrpDiscount,
    effectiveStock,
    primaryImage: primaryImage
      ? { image_url: primaryImage.image_url, thumbnail_url: primaryImage.thumbnail_url }
      : null,
    brandName: p.brands?.name || null,
    categoryName: p.categories?.name || null,
    discountPct: Number(p.discount_pct ?? 0),
    extraDeliveryDays: Number(p.extra_delivery_days ?? 0),
    handlingDays: Number(p.handling_days ?? 2),
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await authenticateUser(req)

    // Logged-out → best-sellers fallback (anonymous browsing isn't attributable).
    if (!user) {
      const cards = await getBestSellerCards(8)
      return NextResponse.json({
        products: cards.map(toCardProps),
        source: 'bestsellers',
        curated: false,
        fallback: true,
      })
    }

    const result = await getFeaturedForUser(user.userId, 8)

    // Fire-and-forget analytics — never let logging break the response.
    query(
      `INSERT INTO ai_queries
         (user_id, query_text, candidate_count, recommended_count, response_ms, model, prompt_tokens, completion_tokens, recommended_product_ids, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        user.userId,
        `featured-for-you: ${result.seedQuery}`.slice(0, 2000),
        result.candidateCount,
        result.products.length,
        result.responseMs ?? null,
        result.model ?? `rec:${result.source}`,
        result.promptTokens ?? null,
        result.completionTokens ?? null,
        result.products.map(p => p.id),
        result.curated ? null : `uncurated (${result.source})`,
      ]
    ).catch(() => {})

    return NextResponse.json({
      products: result.products.map(toCardProps),
      source: result.source,
      curated: result.curated,
    })
  } catch {
    // Never 500 to the homepage — the section just hides.
    return NextResponse.json({ products: [] })
  }
}
