import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import path from 'path'
import fs from 'fs'

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    const config: any = {
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    }

    // Enable SSL for RDS connections
    if (process.env.DATABASE_URL?.includes('rds.amazonaws.com')) {
      const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
      if (fs.existsSync(certPath)) {
        config.ssl = {
          rejectUnauthorized: true,
          ca: fs.readFileSync(certPath).toString(),
        }
      } else {
        config.ssl = { rejectUnauthorized: false }
      }
    }

    pool = new Pool(config)

    pool.on('error', (err) => {
      console.error('Unexpected database pool error:', err)
    })
  }
  return pool
}

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const p = getPool()
  return p.query<T>(text, params)
}

export async function queryOne<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T | null> {
  const result = await query<T>(text, params)
  return result.rows[0] || null
}

export async function queryMany<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await query<T>(text, params)
  return result.rows
}

export async function queryCount(text: string, params?: any[]): Promise<number> {
  const result = await query(text, params)
  return parseInt(result.rows[0]?.count || '0', 10)
}

export async function getClient(): Promise<PoolClient> {
  return getPool().connect()
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
