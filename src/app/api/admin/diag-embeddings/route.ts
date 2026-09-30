import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { isPlatformAdmin } from '@/lib/scopes'
import { embed, runWithHnswTuning, queryManyReplica } from '@/lib/rag'

export const dynamic = 'force-dynamic'

function vec(arr: number[]) {
  return '[' + arr.join(',') + ']'
}

export async function GET(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || 'dowel pin m10').trim()
  const limit = Math.min(parseInt(searchParams.get('limit') || '10', 10), 30)

  // 1. Check total embedding counts
  const counts = await queryManyReplica<{ source_table: string; cnt: string }>(
    `SELECT source_table, COUNT(*)::text AS cnt FROM embeddings GROUP BY source_table ORDER BY source_table`
  ).catch(() => [])

  // 2. Embed the query
  let embedding: number[] | null = null
  let embedError: string | null = null
  try {
    embedding = await embed(q)
  } catch (e: any) {
    embedError = String(e?.message || e)
  }

  // 3. HNSW search
  let hnswRows: any[] = []
  let hnswError: string | null = null
  if (embedding) {
    try {
      const result = await runWithHnswTuning(
        `SELECT source_table, source_id, content,
                1 - (embedding <=> $1::vector) AS sim
         FROM embeddings
         WHERE source_table IN ('products', 'product_variants')
         ORDER BY embedding <=> $1::vector
         LIMIT $2`,
        [vec(embedding), limit]
      )
      hnswRows = result.rows.map((r: any) => ({
        source_table: r.source_table,
        source_id: r.source_id,
        sim: typeof r.sim === 'string' ? parseFloat(r.sim) : r.sim,
        content: (r.content || '').slice(0, 120),
      }))
    } catch (e: any) {
      hnswError = String(e?.message || e)
    }
  }

  // 4. Hydrate product names for matched IDs
  const productIds = hnswRows.filter(r => r.source_table === 'products').map(r => r.source_id)
  const variantIds = hnswRows.filter(r => r.source_table === 'product_variants').map(r => r.source_id)

  let products: any[] = []
  let variantProducts: any[] = []
  if (productIds.length) {
    products = await queryManyReplica(`SELECT id::text, name, slug FROM products WHERE id = ANY($1::uuid[])`, [
      productIds,
    ]).catch(() => [])
  }
  if (variantIds.length) {
    variantProducts = await queryManyReplica(
      `SELECT pv.id::text AS variant_id, p.id::text AS product_id, p.name, pv.variant_label
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       WHERE pv.id = ANY($1::uuid[])`,
      [variantIds]
    ).catch(() => [])
  }

  const productMap = Object.fromEntries(products.map(p => [p.id, p]))
  const variantMap = Object.fromEntries(variantProducts.map(v => [v.variant_id, v]))

  const enriched = hnswRows.map(r => {
    if (r.source_table === 'products') {
      const p = productMap[r.source_id]
      return { ...r, product_name: p?.name, slug: p?.slug }
    } else {
      const v = variantMap[r.source_id]
      return { ...r, product_id: v?.product_id, product_name: v?.name, variant_label: v?.variant_label }
    }
  })

  return NextResponse.json({
    query: q,
    embedding_dim: embedding?.length ?? null,
    embed_error: embedError,
    hnsw_error: hnswError,
    table_counts: counts,
    results: enriched,
  })
}
