import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'
import path from 'path'
import fs from 'fs'
import { Signer } from '@aws-sdk/rds-signer'
import { getCurrentAuditAdminId, setAuditAdminId, runWithAuditContext } from './audit-context'

let pool: Pool | null = null

export { getCurrentAuditAdminId, setAuditAdminId, runWithAuditContext }

function makeRdsSigner(host: string, port: number, user: string, region: string): () => Promise<string> {
  const signer = new Signer({ hostname: host, port, region, username: user })
  return () => signer.getAuthToken()
}

function getPool(): Pool {
  if (!pool) {
    const dbUrl = process.env.DATABASE_URL || ''
    const useIamAuth = process.env.RDS_IAM_AUTH === 'true'

    const workers = parseInt(process.env.WEB_CONCURRENCY || '1', 10)
    const poolMax = Math.max(2, Math.floor(15 / workers))

    const config: any = {
      max: poolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    }

    if (useIamAuth) {
      const host = process.env.RDS_HOST!
      const port = parseInt(process.env.RDS_PORT || '5432', 10)
      const user = process.env.RDS_USER!
      const dbName = process.env.RDS_DB!
      const region = process.env.AWS_REGION || 'us-east-1'

      const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
      config.host = host
      config.port = port
      config.user = user
      config.database = dbName
      config.ssl = fs.existsSync(certPath)
        ? { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
        : { rejectUnauthorized: false }
      config.password = makeRdsSigner(host, port, user, region)
    } else {
      if (dbUrl.includes('rds.amazonaws.com')) {
        // Strip sslmode/uselibpqcompat from the URL — pg v8 treats sslmode=require as
        // verify-full and overrides our ssl object, causing SELF_SIGNED_CERT_IN_CHAIN.
        // We control TLS entirely via the ssl: { ca } option below.
        const cleanUrl = dbUrl.replace(/[?&](sslmode|uselibpqcompat)=[^&]*/g, '').replace(/[?&]$/, '')
        config.connectionString = cleanUrl
        const certPath = path.join(process.cwd(), 'certs', 'global-bundle.pem')
        if (!fs.existsSync(certPath)) {
          throw new Error(`RDS TLS certificate not found at ${certPath}. Download from https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem`)
        }
        config.ssl = { rejectUnauthorized: true, ca: fs.readFileSync(certPath).toString() }
      } else {
        config.connectionString = dbUrl
      }
    }

    pool = new Pool(config)
    pool.on('error', (err) => {
      pool!.query(
        `INSERT INTO _debug_log (source, payload) VALUES ($1, $2)`,
        ['pool.error', JSON.stringify({ msg: (err as any)?.message, code: (err as any)?.code })]
      ).catch(() => {})
    })
  }
  return pool
}

function isMutation(text: string): boolean {
  const t = text.trimStart().toUpperCase()
  return t.startsWith('INSERT') || t.startsWith('UPDATE') || t.startsWith('DELETE')
}

async function getRequestAdminId(): Promise<string | null> {
  const local = getCurrentAuditAdminId()
  if (local) return local
  try {
    const { cookies } = await import('next/headers')
    const sid = (await cookies()).get('admin_sid')?.value
    if (!sid) return null
    // Cookie value is the opaque session id. Dynamic import avoids a db.ts ↔ auth-sessions
    // circular import at module load.
    const { resolveSession } = await import('./auth-sessions')
    const s = await resolveSession(sid)
    return s && s.principalType === 'admin' ? s.principalId : null
  } catch {
    return null
  }
}

export async function query<T extends QueryResultRow = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const p = getPool()
  if (isMutation(text)) {
    const adminId = await getRequestAdminId()
    if (adminId) {
      const client = await p.connect()
      try {
        await client.query('BEGIN')
        await client.query(`SELECT set_config('audit.admin_id', $1, true)`, [adminId])
        const result = await client.query<T>(text, params)
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }
    }
  }
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
  const client = await getPool().connect()
  const adminId = await getRequestAdminId()
  if (adminId) {
    await client.query(`SELECT set_config('audit.admin_id', $1, false)`, [adminId]).catch(() => {})
    const originalRelease = client.release.bind(client)
    ;(client as any).release = (err?: Error | boolean) => {
      client.query(`SELECT set_config('audit.admin_id', '', false)`).catch(() => {}).finally(() => {
        originalRelease(err as any)
      })
    }
  }
  return client
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const adminId = await getRequestAdminId()
    if (adminId) {
      await client.query(`SELECT set_config('audit.admin_id', $1, true)`, [adminId])
    }
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
