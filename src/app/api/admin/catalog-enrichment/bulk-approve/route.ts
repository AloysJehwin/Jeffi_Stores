import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryMany } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface LogRow {
  id: string
  product_id: string
  ai_description: string
  ai_use_cases: string[]
  ai_keywords: string[] | null
  ai_who_uses_it: string | null
  ai_application: string | null
  ai_product_type: string | null
  ai_features: string[] | null
  ai_search_tags: string[] | null
}

async function reEmbed(productId: string): Promise<boolean> {
  try {
    const { embed } = await import('@/lib/rag')
    const { Pool } = await import('pg')
    const { queryOne } = await import('@/lib/db')

    const product = await queryOne<{
      name: string; sku: string | null
      ai_description: string | null; description: string | null
      ai_use_cases: string[] | null; ai_keywords: string[] | null
      ai_who_uses_it: string | null; ai_application: string | null
      ai_product_type: string | null; ai_features: string[] | null
      ai_search_tags: string[] | null
    }>(
      `SELECT name, sku, ai_description, description, ai_use_cases,
              ai_keywords, ai_who_uses_it, ai_application, ai_product_type,
              ai_features, ai_search_tags
         FROM products WHERE id = $1::uuid`,
      [productId]
    )
    if (!product) return false

    const desc = product.ai_description || product.description || ''
    const content = [
      product.name,
      product.sku ? `SKU: ${product.sku}` : '',
      product.ai_product_type ? `Type: ${product.ai_product_type}` : '',
      desc ? `Description: ${desc}` : '',
      product.ai_application ? `Application: ${product.ai_application}` : '',
      product.ai_who_uses_it ? `Used by: ${product.ai_who_uses_it}` : '',
      (product.ai_use_cases || []).length ? `Use cases: ${product.ai_use_cases!.join(', ')}` : '',
      (product.ai_keywords || []).length ? `Keywords: ${product.ai_keywords!.join(', ')}` : '',
      (product.ai_features || []).length ? `Features: ${product.ai_features!.join(', ')}` : '',
      (product.ai_search_tags || []).length ? `Tags: ${product.ai_search_tags!.join(', ')}` : '',
    ].filter(Boolean).join('\n')

    const vec = await embed(content)
    const vecLit = '[' + vec.join(',') + ']'
    const crypto = await import('node:crypto')
    const hash = crypto.createHash('sha256').update(content).digest('hex')

    const pool = new Pool({
      host: process.env.RAG_PG_HOST || '100.82.208.8',
      port: parseInt(process.env.RAG_PG_PORT || '5432', 10),
      user: process.env.RAG_PG_USER || 'postgres',
      password: process.env.RAG_PG_PASSWORD || process.env.RDS_MASTER_PASSWORD,
      database: process.env.RAG_PG_DB || 'jeffi_dev',
      max: 2,
      connectionTimeoutMillis: 4000,
    })
    await pool.query(
      `INSERT INTO embeddings (source_table, source_id, content, content_hash, embedding, updated_at)
       VALUES ('products', $1, $2, $3, $4::vector, NOW())
       ON CONFLICT (source_table, source_id)
       DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
                     embedding = EXCLUDED.embedding, updated_at = NOW()`,
      [productId, content, hash, vecLit]
    )
    await pool.end()
    return true
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'catalog_enrichment')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const body = await req.json() as { ids?: string[]; action?: string }
  const ids: string[] = Array.isArray(body.ids) ? body.ids : []
  const action = body.action === 'reject' ? 'reject' : 'approve'

  if (ids.length === 0) return NextResponse.json({ error: 'No ids provided' }, { status: 400 })
  if (ids.length > 200) return NextResponse.json({ error: 'Max 200 per bulk operation' }, { status: 400 })

  const rows = await queryMany<LogRow>(
    `SELECT id::text, product_id::text,
            ai_description, ai_use_cases, ai_keywords, ai_who_uses_it,
            ai_application, ai_product_type, ai_features, ai_search_tags
       FROM product_ai_enrichment_log
      WHERE id = ANY($1::uuid[]) AND status = 'proposed'`,
    [ids]
  )

  if (rows.length === 0) return NextResponse.json({ processed: 0 })

  if (action === 'reject') {
    await query(
      `UPDATE product_ai_enrichment_log
          SET status = 'rejected', decided_at = NOW(), decided_by_admin_id = $1::uuid
        WHERE id = ANY($2::uuid[]) AND status = 'proposed'`,
      [admin.adminId, ids]
    )
    return NextResponse.json({ processed: rows.length, action: 'rejected' })
  }

  await query(
    `UPDATE product_ai_enrichment_log
        SET status = 'approved', decided_at = NOW(), decided_by_admin_id = $1::uuid
      WHERE id = ANY($2::uuid[]) AND status = 'proposed'`,
    [admin.adminId, ids]
  )

  for (const row of rows) {
    await query(
      `UPDATE products
          SET ai_description = $1, ai_use_cases = $2,
              ai_keywords = $3, ai_who_uses_it = $4, ai_application = $5,
              ai_product_type = $6, ai_features = $7, ai_search_tags = $8,
              ai_enriched_at = NOW(), updated_at = NOW()
        WHERE id = $9::uuid`,
      [row.ai_description, row.ai_use_cases,
       row.ai_keywords, row.ai_who_uses_it, row.ai_application,
       row.ai_product_type, row.ai_features, row.ai_search_tags,
       row.product_id]
    )
  }

  let embedded = 0
  await Promise.all(rows.map(async row => {
    const ok = await reEmbed(row.product_id)
    await query(
      `UPDATE product_ai_enrichment_log
          SET promoted_at = NOW(),
              re_embedded_at = CASE WHEN $1 THEN NOW() ELSE re_embedded_at END
        WHERE id = $2::uuid`,
      [ok, row.id]
    )
    if (ok) embedded++
  }))

  return NextResponse.json({ processed: rows.length, embedded, action: 'approved' })
}
