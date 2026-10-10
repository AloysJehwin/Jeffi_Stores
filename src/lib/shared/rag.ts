import { Pool } from 'pg'
import { createPgPool, rdsSslOption, rdsIamPassword } from '@/lib/shared/pg-pool'

export interface RagResult {
  source_table: string
  source_id: string
  content: string
  similarity: number
  metadata: Record<string, unknown>
}

export interface FindSimilarOptions {
  limit?: number
  sourceTable?: string
  sourceTables?: string[]
  minSimilarity?: number
}

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    const host = process.env.RAG_PG_HOST || '100.82.208.8'
    const port = parseInt(process.env.RAG_PG_PORT || '5432', 10)
    const user = process.env.RAG_PG_USER || 'postgres'
    const database = process.env.RAG_PG_DB || 'jeffi_replica'

    const config: any = {
      host,
      port,
      user,
      database,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    }

    if (process.env.RAG_PG_IAM_AUTH === 'true') {
      // Prod: authenticate to RDS via IAM (like the main pool in db.ts) — no stored
      // password. Uses the RDS CA bundle for real cert verification when present.
      const region = process.env.AWS_REGION || 'us-east-1'
      config.password = rdsIamPassword(host, port, user, region)
      config.ssl = rdsSslOption()
    } else {
      config.password = process.env.RAG_PG_PASSWORD || process.env.RDS_MASTER_PASSWORD
      // RDS requires SSL; set RAG_PG_SSL=1 when pointing at RDS with a password.
      // Cert isn't verified (dev connects over the SSH tunnel). Razer replica needs no SSL.
      config.ssl = process.env.RAG_PG_SSL === '1' ? { rejectUnauthorized: false } : undefined
    }

    pool = createPgPool(config)
  }
  return pool
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`
}

// The tenant whose embeddings a RAG read may touch (#489). Resolved ALS-safely (header bridge when
// ALS is empty). A tenant sees ONLY its own rows (tenant_id = its id); the platform/flagship sees
// its own rows (tenant_id IS NULL). There is NO cross-tenant or platform fallback: a tenant with no
// embeddings yet gets [] rather than another store's data. Returns the uuid, or null for platform.
async function currentRagTenantId(): Promise<string | null> {
  try {
    const { resolveTenantId } = await import('@/lib/tenancy/tenant-context')
    return await resolveTenantId()
  } catch {
    return null
  }
}

// `tenant_id IS NOT DISTINCT FROM $n` matches a tenant's own rows, and NULL=NULL for the platform.
// Appends the param and returns the SQL predicate referencing it.
function tenantPredicate(params: unknown[], tenantId: string | null): string {
  params.push(tenantId)
  return `tenant_id IS NOT DISTINCT FROM $${params.length}`
}

export async function queryManyReplica<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  // Raw replica access runs opaque caller SQL against the platform-only replica, so it can't be
  // tenant-filtered generically. On a tenant request it would leak platform data → refuse and
  // return []. Platform (off-tenant) callers are unaffected. (#489)
  if (await currentRagTenantId()) return []
  const client = await getPool().connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}

export async function embed(text: string): Promise<number[]> {
  // Embeddings now go through the ai-platform gateway (queue + cache + provider), not
  // Ollama directly. The gateway owns the model + host selection.
  const { aiEmbed } = await import('@/lib/shared/ai-client')
  const [vector] = await aiEmbed(text)
  if (!vector || !Array.isArray(vector)) {
    throw new Error('Gateway embed response missing embedding array')
  }
  return vector
}

export async function findSimilar(query: string, opts: FindSimilarOptions = {}): Promise<RagResult[]> {
  const limit = opts.limit ?? 10
  const minSimilarity = opts.minSimilarity
  const tables = opts.sourceTables ?? (opts.sourceTable ? [opts.sourceTable] : undefined)

  const vec = await embed(query)
  const vecLiteral = toVectorLiteral(vec)
  const tenantId = await currentRagTenantId()

  const params: unknown[] = [vecLiteral]
  // A tenant reads only its own embeddings; the platform reads its own (NULL). No fallback.
  const where: string[] = [tenantPredicate(params, tenantId)]

  if (tables && tables.length > 0) {
    params.push(tables)
    where.push(`source_table = ANY($${params.length}::text[])`)
  }

  if (typeof minSimilarity === 'number') {
    params.push(minSimilarity)
    where.push(`1 - (embedding <=> $1::vector) >= $${params.length}`)
  }

  params.push(limit)
  const limitIdx = params.length

  const sql = `
    SELECT
      source_table,
      source_id,
      content,
      metadata,
      1 - (embedding <=> $1::vector) AS similarity
    FROM embeddings
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY embedding <=> $1::vector
    LIMIT $${limitIdx}
  `

  const result = await runWithHnswTuning(sql, params)
  return result.rows.map(row => ({
    source_table: row.source_table,
    source_id: row.source_id,
    content: row.content,
    similarity: typeof row.similarity === 'string' ? parseFloat(row.similarity) : row.similarity,
    metadata: row.metadata ?? {},
  }))
}

const HNSW_EF_SEARCH = parseInt(process.env.RAG_HNSW_EF_SEARCH || '200', 10)

export async function runWithHnswTuning(sql: string, params: unknown[]) {
  const client = await getPool().connect()
  try {
    await client.query(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`)
    return await client.query(sql, params)
  } finally {
    client.release()
  }
}

// Same HNSW-tuned vector query, but on the CURRENT TENANT's pool (db.ts) instead of the shared
// replica. Each tenant's product embeddings live in that tenant's own DB (written by the catalog-
// enrichment approve path), so product search must read there. SET LOCAL only holds inside a
// transaction, so wrap the tuning + SELECT in one. The flagship reads its own DB and is unaffected.
async function tenantHnswQuery<T extends Record<string, any> = any>(sql: string, params: unknown[]): Promise<T[]> {
  const { getClient } = await import('@/lib/shared/db')
  const client = await getClient()
  try {
    await client.query('BEGIN')
    await client.query(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`)
    const r = await client.query(sql, params)
    await client.query('COMMIT')
    return r.rows as T[]
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

export async function findSimilarProducts(query: string, limit = 5): Promise<RagResult[]> {
  return findSimilar(query, { limit, sourceTables: ['products', 'product_variants'] })
}

export interface SimilarProductId {
  productId: string
  similarity: number
  matchedVia: 'products' | 'product_variants'
  variantId: string | null
}

export async function findSimilarProductIds(query: string, limit = 20): Promise<SimilarProductId[]> {
  const vec = await embed(query)
  const vecLiteral = toVectorLiteral(vec)

  // Read the CURRENT TENANT's own embeddings table (flagship = its own DB). Within a tenant DB every
  // row is that tenant's, so no tenant_id filter is needed — the pool itself is the isolation (#489).
  const productSql = `
    SELECT source_id, 1 - (embedding <=> $1::vector) AS similarity
      FROM embeddings
     WHERE source_table = 'products'
     ORDER BY embedding <=> $1::vector
     LIMIT $2
  `
  const variantSql = `
    SELECT source_id, 1 - (embedding <=> $1::vector) AS similarity
      FROM embeddings
     WHERE source_table = 'product_variants'
     ORDER BY embedding <=> $1::vector
     LIMIT $2
  `
  const [productRows, variantRows, keywordRows] = await Promise.all([
    tenantHnswQuery<{ source_id: string; similarity: number | string }>(productSql, [vecLiteral, limit]),
    tenantHnswQuery<{ source_id: string; similarity: number | string }>(variantSql, [vecLiteral, limit]),
    keywordProductIds(query, limit),
  ])

  const merged: SimilarProductId[] = []
  for (const row of productRows) {
    const sim = typeof row.similarity === 'string' ? parseFloat(row.similarity) : row.similarity
    merged.push({ productId: row.source_id, similarity: sim, matchedVia: 'products', variantId: null })
  }
  for (const row of variantRows) {
    const sim = typeof row.similarity === 'string' ? parseFloat(row.similarity) : row.similarity
    merged.push({ productId: '', similarity: sim, matchedVia: 'product_variants', variantId: row.source_id })
  }

  merged.sort((a, b) => b.similarity - a.similarity)

  // Concept→product queries ("hang a portrait" → screws) legitimately score
  // ~0.4-0.5 with nomic-embed; 0.50 was too strict and dropped good matches,
  // forcing a weak keyword fallback. 0.35 keeps relevant hits while excluding noise.
  const MIN_SIM = 0.35
  const seenProducts = new Set<string>()
  const out: SimilarProductId[] = []
  for (const r of merged) {
    if (r.similarity < MIN_SIM) break
    if (r.matchedVia === 'products') {
      if (seenProducts.has(r.productId)) continue
      seenProducts.add(r.productId)
    }
    out.push(r)
    if (out.length >= limit) break
  }

  // Hybrid: fold in keyword/full-text product hits the vector search missed.
  // Semantic search drifts on project-style queries ("wooden shelf" pulls
  // woodworking tools), so literal term matches (screw/bolt/bracket…) are added
  // with a high synthetic similarity and kept ahead of weak vector hits.
  for (const pid of keywordRows) {
    if (seenProducts.has(pid)) continue
    seenProducts.add(pid)
    out.unshift({ productId: pid, similarity: 0.99, matchedVia: 'products', variantId: null })
  }
  return out.slice(0, limit)
}

/**
 * Full-text / keyword product match — complements the vector search so literal
 * fastener/hardware terms surface even when embeddings drift off-topic. Uses the
 * products.search_vector when available, falling back to name/description ILIKE.
 */
async function keywordProductIds(query: string, limit: number): Promise<string[]> {
  // Full-text keyword match over the CURRENT TENANT's own `products` (via the tenant pool), so literal
  // terms surface alongside the vector hits. Tenant-safe: `products.search_vector` is read from the
  // tenant's own DB, same place findSimilarProductIds reads embeddings.
  const { queryMany } = await import('@/lib/shared/db')
  // Salient tokens: drop stopwords / connectors, keep words >= 3 chars.
  const STOP = new Set([
    'for',
    'the',
    'and',
    'need',
    'want',
    'what',
    'which',
    'with',
    'from',
    'that',
    'this',
    'building',
    'build',
    'make',
    'making',
    'some',
    'any',
    'are',
    'you',
    'your',
    'have',
    'get',
    'looking',
    'about',
    'help',
  ])
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP.has(t))
  if (tokens.length === 0) return []
  const tsquery = tokens.join(' | ')
  try {
    const rows = await queryMany<{ source_id: string }>(
      `SELECT id::text AS source_id
         FROM products
        WHERE is_active = true
          AND search_vector @@ to_tsquery('english', $1)
        ORDER BY ts_rank(search_vector, to_tsquery('english', $1)) DESC
        LIMIT $2`,
      [tsquery, limit]
    )
    return rows.map(row => row.source_id)
  } catch {
    return []
  }
}

export async function findSimilarCustomers(query: string, limit = 5): Promise<RagResult[]> {
  return findSimilar(query, { limit, sourceTable: 'users' })
}
