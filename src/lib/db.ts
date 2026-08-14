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
      // Keep a connection warm so the pool is rarely fully cold. A cold IAM+TLS
      // connect to RDS legitimately takes 0.5–3.3s (measured), so the previous
      // 30s idle timeout + 5s connect timeout combo could wedge the pool: during
      // low traffic every connection went idle-closed, then the next request had
      // to cold-connect and a latency spike past 5s failed it, with nothing to
      // fall back on. Warm keepalive'd connections + a longer connect budget fix that.
      min: 1,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
      // Rotate connections before RDS's own idle/lifetime limits can silently kill them.
      maxUses: 7500,
      allowExitOnIdle: false,
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
    // Fires when an *idle* pooled client errors out (e.g. RDS drops the socket).
    // pg has already removed the bad client from the pool by the time this runs,
    // so the pool self-heals on its own. We must keep this listener registered so
    // an idle-client error does not crash the process as an unhandled 'error'
    // event — but we deliberately do NOTHING here. The previous handler issued a
    // query on the *same* pool to log the error; if the pool was degraded that
    // query failed too, and a connect-time failure never emits this event anyway,
    // so it recorded nothing while adding load. No-op is the correct, safe choice.
    pool.on('error', () => { /* idle-client error — pool already evicted it; no action needed */ })
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
