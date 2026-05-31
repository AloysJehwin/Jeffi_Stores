import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { query, queryOne } from '@/lib/db'

export const dynamic = 'force-dynamic'

interface EnrichmentRow {
  id: string
  product_id: string
  ai_description: string
  ai_use_cases: string[]
  status: string
}

async function reEmbedProduct(productId: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { embed } = await import('@/lib/rag')
    const { Pool } = await import('pg')

    const pool = new Pool({
      host: process.env.RAG_PG_HOST || '100.110.153.68',
      port: parseInt(process.env.RAG_PG_PORT || '5432', 10),
      user: process.env.RAG_PG_USER || 'postgres',
      password: process.env.RAG_PG_PASSWORD || process.env.RDS_MASTER_PASSWORD,
      database: process.env.RAG_PG_DB || 'jeffi_dev',
      max: 2,
      connectionTimeoutMillis: 4000,
    })

    const product = await queryOne<{
      name: string
      sku: string | null
      ai_description: string | null
      description: string | null
      ai_use_cases: string[] | null
    }>(
      `SELECT name, sku, ai_description, description, ai_use_cases
         FROM products WHERE id = $1::uuid`,
      [productId]
    )
    if (!product) return { ok: false, error: 'product not found for embed' }

    const desc = product.ai_description || product.description || ''
    const tags = (product.ai_use_cases || []).join(', ')
    const content = [
      product.name,
      product.sku ? `SKU: ${product.sku}` : '',
      desc ? `Description: ${desc}` : '',
      tags ? `Use cases: ${tags}` : '',
    ].filter(Boolean).join('\n')

    const vec = await embed(content)
    const vecLit = '[' + vec.join(',') + ']'
    const crypto = await import('node:crypto')
    const hash = crypto.createHash('sha256').update(content).digest('hex')

    await pool.query(
      `INSERT INTO embeddings (source_table, source_id, content, content_hash, embedding, updated_at)
       VALUES ('products', $1, $2, $3, $4::vector, NOW())
       ON CONFLICT (source_table, source_id)
       DO UPDATE SET content = EXCLUDED.content, content_hash = EXCLUDED.content_hash,
                     embedding = EXCLUDED.embedding, updated_at = NOW()`,
      [productId, content, hash, vecLit]
    )
    await pool.end()
    return { ok: true }
  } catch (err: any) {
    return { ok: false, error: err?.message || 'embed failed' }
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'products')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const row = await queryOne<EnrichmentRow>(
    `SELECT id::text, product_id::text, ai_description, ai_use_cases, status
       FROM product_ai_enrichment_log WHERE id = $1::uuid`,
    [params.id]
  )
  if (!row) return NextResponse.json({ error: 'Enrichment not found' }, { status: 404 })
  if (row.status !== 'proposed') {
    return NextResponse.json({ error: `Already ${row.status}` }, { status: 400 })
  }

  await query(
    `UPDATE product_ai_enrichment_log
        SET status = 'approved', decided_at = NOW(), decided_by_admin_id = $1::uuid
      WHERE id = $2::uuid`,
    [admin.adminId, params.id]
  )

  await query(
    `UPDATE products
        SET ai_description = $1, ai_use_cases = $2, ai_enriched_at = NOW(), updated_at = NOW()
      WHERE id = $3::uuid`,
    [row.ai_description, row.ai_use_cases, row.product_id]
  )

  const embedResult = await reEmbedProduct(row.product_id)

  await query(
    `UPDATE product_ai_enrichment_log
        SET promoted_at = NOW(),
            re_embedded_at = CASE WHEN $1 THEN NOW() ELSE re_embedded_at END,
            error = $2
      WHERE id = $3::uuid`,
    [embedResult.ok, embedResult.ok ? null : embedResult.error || null, params.id]
  )

  return NextResponse.json({
    ok: true,
    promoted: true,
    reEmbedded: embedResult.ok,
    embedError: embedResult.ok ? null : embedResult.error,
  })
}
