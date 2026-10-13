import type pg from 'pg'
import { currentAdminId, requireTenant } from './context'
import { tenantPool } from './pools'

type Row = pg.QueryResultRow

const pool = () => tenantPool(requireTenant())
const isMutation = (t: string) => /^(INSERT|UPDATE|DELETE)/i.test(t.trimStart())

export async function query<T extends Row = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  const p = pool()
  const adminId = currentAdminId()
  if (adminId && isMutation(text)) {
    const client = await p.connect()
    try {
      await client.query('BEGIN')
      await client.query(`SELECT set_config('audit.admin_id', $1, true)`, [adminId])
      const r = await client.query<T>(text, params)
      await client.query('COMMIT')
      return r
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  }
  return p.query<T>(text, params)
}

export async function queryOne<T extends Row = any>(text: string, params?: any[]): Promise<T | null> {
  return (await query<T>(text, params)).rows[0] ?? null
}

export async function queryMany<T extends Row = any>(text: string, params?: any[]): Promise<T[]> {
  return (await query<T>(text, params)).rows
}

export async function queryCount(text: string, params?: any[]): Promise<number> {
  return parseInt((await query(text, params)).rows[0]?.count || '0', 10)
}

export async function getClient(): Promise<pg.PoolClient> {
  const client = await pool().connect()
  const adminId = currentAdminId()
  if (adminId) {
    await client.query(`SELECT set_config('audit.admin_id', $1, false)`, [adminId]).catch(() => {})
    const release = client.release.bind(client)
    ;(client as any).release = (err?: Error | boolean) => {
      client.query(`SELECT set_config('audit.admin_id', '', false)`).catch(() => {}).finally(() => release(err as any))
    }
  }
  return client
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient()
  try {
    await client.query('BEGIN')
    const adminId = currentAdminId()
    if (adminId) await client.query(`SELECT set_config('audit.admin_id', $1, true)`, [adminId])
    const r = await fn(client)
    await client.query('COMMIT')
    return r
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}
