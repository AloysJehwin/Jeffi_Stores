import { Pool } from 'pg'

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
    const password = process.env.RAG_PG_PASSWORD || process.env.RDS_MASTER_PASSWORD
    pool = new Pool({
      host: process.env.RAG_PG_HOST || '100.82.208.8',
      port: parseInt(process.env.RAG_PG_PORT || '5432', 10),
      user: process.env.RAG_PG_USER || 'postgres',
      password,
      database: process.env.RAG_PG_DB || 'jeffi_replica',
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
    pool.on('error', () => {})
  }
  return pool
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.join(',')}]`
}

export async function queryManyReplica<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const client = await getPool().connect()
  try {
    const result = await client.query(sql, params)
    return result.rows as T[]
  } finally {
    client.release()
  }
}

export async function embed(text: string): Promise<number[]> {
  const url = process.env.RAG_OLLAMA_URL || 'http://100.82.208.8:11434'
  const model = process.env.RAG_EMBED_MODEL || 'nomic-embed-text'

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)

  let res: Response
  try {
    res = await fetch(`${url}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }

  if (!res.ok) {
    throw new Error(`Ollama embed failed: ${res.status} ${res.statusText}`)
  }

  const data = (await res.json()) as { embedding?: number[] }
  if (!data.embedding || !Array.isArray(data.embedding)) {
    throw new Error('Ollama embed response missing embedding array')
  }
  return data.embedding
}

export async function findSimilar(
  query: string,
  opts: FindSimilarOptions = {}
): Promise<RagResult[]> {
  const limit = opts.limit ?? 10
  const minSimilarity = opts.minSimilarity
  const tables = opts.sourceTables ?? (opts.sourceTable ? [opts.sourceTable] : undefined)

  const vec = await embed(query)
  const vecLiteral = toVectorLiteral(vec)

  const params: unknown[] = [vecLiteral]
  const where: string[] = []

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
  return result.rows.map((row) => ({
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
  const [productResult, variantResult] = await Promise.all([
    runWithHnswTuning(productSql, [vecLiteral, limit]),
    runWithHnswTuning(variantSql, [vecLiteral, limit]),
  ])

  const merged: SimilarProductId[] = []
  for (const row of productResult.rows) {
    const sim = typeof row.similarity === 'string' ? parseFloat(row.similarity) : row.similarity
    merged.push({ productId: row.source_id, similarity: sim, matchedVia: 'products', variantId: null })
  }
  for (const row of variantResult.rows) {
    const sim = typeof row.similarity === 'string' ? parseFloat(row.similarity) : row.similarity
    merged.push({ productId: '', similarity: sim, matchedVia: 'product_variants', variantId: row.source_id })
  }

  merged.sort((a, b) => b.similarity - a.similarity)

  const MIN_SIM = 0.50
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
  return out
}

export async function findSimilarCustomers(query: string, limit = 5): Promise<RagResult[]> {
  return findSimilar(query, { limit, sourceTable: 'users' })
}
