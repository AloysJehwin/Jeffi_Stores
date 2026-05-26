import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import path from 'path'
import fs from 'fs'
import { Signer } from '@aws-sdk/rds-signer'

let pool: Pool | null = null

function makeRdsSigner(host: string, port: number, user: string, region: string): () => Promise<string> {
  const signer = new Signer({ hostname: host, port, region, username: user })
  return () => signer.getAuthToken()
}

function getPool(): Pool {
  if (!pool) {
    const dbUrl = process.env.DATABASE_URL || ''
    const useIamAuth = process.env.RDS_IAM_AUTH === 'true'

    const config: any = {
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    }

    if (useIamAuth) {
      const host = process.env.RDS_HOST!
      const port = parseInt(process.env.RDS_PORT || '5432', 10)
      const user = process.env.RDS_USER!
      const dbName = process.env.RDS_DB!
      const region = process.env.AWS_REGION || 'us-east-1'

      config.host = host
      config.port = port
      config.user = user
      config.database = dbName
      config.ssl = { rejectUnauthorized: false }
      config.password = makeRdsSigner(host, port, user, region)
    } else {
      config.connectionString = dbUrl
      if (dbUrl.includes('rds.amazonaws.com')) {
        const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
        config.ssl = fs.existsSync(certPath)
          ? { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
          : { rejectUnauthorized: false }
      }
    }

    pool = new Pool(config)
    pool.on('error', () => {})
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
