import zlib from 'zlib'
import { promisify } from 'util'
import type { Pool, PoolClient } from 'pg'

const gzip = promisify(zlib.gzip)
const gunzip = promisify(zlib.gunzip)

/**
 * Pure-JS tenant DB backup / restore.
 *
 * No external `pg_dump`/`pg_restore` binary and no extra npm dependency — works on a
 * serverless/Lambda host where those binaries aren't present. We enumerate the tenant
 * DB's `public` base tables, snapshot each as JSON rows, and gzip the whole archive.
 * Restore re-inserts the rows with FK checks + triggers disabled for the load
 * (`session_replication_role = replica`) so table order doesn't matter.
 *
 * The archive is self-describing (JSON) so a future restore never depends on server
 * catalog state matching. Schema itself is NOT in the archive — restore assumes the
 * destination already has the desired-state schema loaded (via buildTenantSchemaSql),
 * exactly as the provisioning `load_schema` step does before `restore_data`.
 */

const ARCHIVE_VERSION = 1

interface TableDump {
  table: string
  columns: string[]
  rows: any[][] // column-ordered tuples
}
interface Archive {
  version: number
  capturedAt: string
  database: string | null
  tables: TableDump[]
}

/** List public base tables (excludes views/foreign tables). */
async function listTables(db: Pool | PoolClient): Promise<string[]> {
  const res = await db.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  )
  return res.rows.map((r: any) => r.table_name)
}

function quoteIdent(name: string): string {
  // Reject anything that isn't a plain identifier — table/column names come from the
  // catalog, not user input, but quote defensively so an odd name can't break the SQL.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier in backup: ${name}`)
  }
  return `"${name}"`
}

/**
 * Snapshot every public table to a gzip'd JSON archive.
 * Accepts a Pool or a checked-out client (the AWS provider passes an IAM-signed pool).
 */
export async function dumpTenantDb(db: Pool | PoolClient, opts?: { database?: string }): Promise<Buffer> {
  const tableNames = await listTables(db)
  const tables: TableDump[] = []

  for (const t of tableNames) {
    const q = quoteIdent(t)
    const res = await db.query(`SELECT * FROM public.${q}`)
    const columns = res.fields.map((f) => f.name)
    const rows = res.rows.map((row: any) => columns.map((c) => row[c]))
    tables.push({ table: t, columns, rows })
  }

  const archive: Archive = {
    version: ARCHIVE_VERSION,
    capturedAt: new Date().toISOString(),
    database: opts?.database ?? null,
    tables,
  }
  // JSON.stringify handles Date/Buffer via pg's parsed types; Buffers become {type:'Buffer',data:[…]}
  return gzip(Buffer.from(JSON.stringify(archive), 'utf8'))
}

/** Rehydrate a value from JSON back into something pg can bind (Buffers survive round-trip). */
function reviveValue(v: any): any {
  if (v && typeof v === 'object' && v.type === 'Buffer' && Array.isArray(v.data)) {
    return Buffer.from(v.data)
  }
  return v
}

/**
 * Restore a gzip'd JSON archive into a DB that already has the schema loaded.
 * Runs inside one transaction with replication-role=replica so FK/trigger order is moot;
 * each table is TRUNCATEd first (idempotent re-runs) then bulk-inserted in chunks.
 */
export async function restoreTenantDb(db: Pool | PoolClient, buffer: Buffer): Promise<{ tables: number; rows: number }> {
  const json = (await gunzip(buffer)).toString('utf8')
  const archive = JSON.parse(json) as Archive
  if (archive.version !== ARCHIVE_VERSION) {
    throw new Error(`Unsupported backup archive version ${archive.version}`)
  }

  // Use a single client so the session-level replication role + txn are coherent.
  const isPool = typeof (db as any).connect === 'function' && !(db as any).release
  const client: PoolClient = isPool ? await (db as Pool).connect() : (db as PoolClient)
  let tableCount = 0
  let rowCount = 0
  try {
    await client.query('BEGIN')
    await client.query(`SET session_replication_role = replica`) // disable FK + triggers for the load

    for (const t of archive.tables) {
      const q = quoteIdent(t.table)
      await client.query(`TRUNCATE public.${q} CASCADE`)
      if (t.rows.length === 0) { tableCount++; continue }

      const cols = t.columns.map(quoteIdent).join(', ')
      // Chunk multi-row INSERTs to stay well under the 65535 bind-param limit.
      const maxParams = 60000
      const perRow = t.columns.length || 1
      const chunkSize = Math.max(1, Math.floor(maxParams / perRow))

      for (let i = 0; i < t.rows.length; i += chunkSize) {
        const chunk = t.rows.slice(i, i + chunkSize)
        const values: any[] = []
        const tuples: string[] = []
        chunk.forEach((row, r) => {
          const ph = row.map((_, c) => `$${r * perRow + c + 1}`)
          tuples.push(`(${ph.join(', ')})`)
          row.forEach((v) => values.push(reviveValue(v)))
        })
        await client.query(
          `INSERT INTO public.${q} (${cols}) VALUES ${tuples.join(', ')}`,
          values,
        )
        rowCount += chunk.length
      }
      tableCount++
    }

    await client.query(`SET session_replication_role = DEFAULT`)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    if (isPool) client.release()
  }
  return { tables: tableCount, rows: rowCount }
}
