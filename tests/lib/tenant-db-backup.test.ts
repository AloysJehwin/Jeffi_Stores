/**
 * Tests for src/lib/tenant-db-backup.ts
 *
 * This is the pure-JS replacement for pg_dump/pg_restore (no binary, so it works
 * on a host that has none). It is the ONLY thing standing between a deprovisioned
 * tenant and permanent data loss, so the properties pinned here are:
 *
 *   - a real gzip round-trip preserves values, INCLUDING bytea (Buffers), which
 *     JSON would otherwise mangle into {type:'Buffer',data:[…]}
 *   - restore runs with session_replication_role=replica inside one transaction,
 *     so FK ordering between tables is irrelevant
 *   - a failure ROLLS BACK rather than leaving a half-restored store
 *   - inserts are chunked to stay under Postgres' 65535 bind-parameter limit
 */
import { describe, it, expect, vi } from 'vitest'
import { dumpTenantDb, restoreTenantDb } from '@/lib/tenant-db-backup'

/** A fake pg client/pool that answers the queries the module issues. */
function makeDb(
  opts: {
    tables?: string[]
    data?: Record<string, { fields: string[]; rows: any[] }>
    failOn?: RegExp
  } = {}
) {
  const tables = opts.tables ?? []
  const data = opts.data ?? {}
  const queries: Array<{ sql: string; params?: any[] }> = []
  const release = vi.fn()

  const query = vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
    queries.push({ sql, params })
    if (opts.failOn && opts.failOn.test(sql)) throw new Error('boom')

    if (/information_schema\.tables/.test(sql)) {
      return { rows: tables.map(t => ({ table_name: t })), fields: [] }
    }
    const m = sql.match(/SELECT \* FROM public\."([^"]+)"/)
    if (m) {
      const d = data[m[1]] ?? { fields: [], rows: [] }
      return { rows: d.rows, fields: d.fields.map(name => ({ name })) }
    }
    return { rows: [], fields: [] }
  })

  return { query, release, queries, connect: undefined as any }
}

/** A pool-shaped db (has connect(), no release()) so restore checks out a client. */
function makePool(client: any) {
  return { connect: vi.fn().mockResolvedValue(client), query: client.query }
}

describe('tenant-db-backup', () => {
  describe('dumpTenantDb', () => {
    it('produces a gzip archive of every public base table', async () => {
      const db = makeDb({
        tables: ['orders', 'products'],
        data: {
          orders: { fields: ['id', 'total'], rows: [{ id: 1, total: '99.00' }] },
          products: { fields: ['id', 'name'], rows: [{ id: 7, name: 'Bolt' }] },
        },
      })
      const buf = await dumpTenantDb(db as any, { database: 'jeffi_stores' })

      expect(Buffer.isBuffer(buf)).toBe(true)
      // gzip magic number
      expect(buf[0]).toBe(0x1f)
      expect(buf[1]).toBe(0x8b)
    })

    it('records the database name and a captured timestamp', async () => {
      const db = makeDb({ tables: [] })
      const buf = await dumpTenantDb(db as any, { database: 'jeffi_stores' })
      const zlib = await import('zlib')
      const json = JSON.parse(zlib.gunzipSync(buf).toString('utf8'))
      expect(json.database).toBe('jeffi_stores')
      expect(json.version).toBe(1)
      expect(new Date(json.capturedAt).toString()).not.toBe('Invalid Date')
    })

    it('defaults the database name to null when not supplied', async () => {
      const db = makeDb({ tables: [] })
      const buf = await dumpTenantDb(db as any)
      const zlib = await import('zlib')
      expect(JSON.parse(zlib.gunzipSync(buf).toString('utf8')).database).toBeNull()
    })

    it('handles a database with no tables', async () => {
      const db = makeDb({ tables: [] })
      const buf = await dumpTenantDb(db as any)
      const zlib = await import('zlib')
      expect(JSON.parse(zlib.gunzipSync(buf).toString('utf8')).tables).toEqual([])
    })

    it('stores rows as column-ordered tuples', async () => {
      const db = makeDb({
        tables: ['t'],
        data: {
          t: {
            fields: ['a', 'b'],
            rows: [
              { a: 1, b: 2 },
              { a: 3, b: 4 },
            ],
          },
        },
      })
      const buf = await dumpTenantDb(db as any)
      const zlib = await import('zlib')
      const arc = JSON.parse(zlib.gunzipSync(buf).toString('utf8'))
      expect(arc.tables[0]).toMatchObject({
        table: 't',
        columns: ['a', 'b'],
        rows: [
          [1, 2],
          [3, 4],
        ],
      })
    })

    it('REFUSES an unsafe table identifier rather than building injectable SQL', async () => {
      const db = makeDb({ tables: ['orders"; DROP TABLE users; --'] })
      await expect(dumpTenantDb(db as any)).rejects.toThrow(/Unsafe identifier in backup/)
    })
  })

  // -------------------------------------------------------------------------
  describe('restoreTenantDb', () => {
    async function archiveOf(tables: any[], version = 1) {
      const zlib = await import('zlib')
      return zlib.gzipSync(
        Buffer.from(
          JSON.stringify({
            version,
            capturedAt: new Date().toISOString(),
            database: 'db',
            tables,
          }),
          'utf8'
        )
      )
    }

    it('rejects an archive from a future/unknown version', async () => {
      const client = makeDb()
      const buf = await archiveOf([], 99)
      await expect(restoreTenantDb(client as any, buf)).rejects.toThrow(/Unsupported backup archive version 99/)
    })

    it('disables FK/triggers for the load so table order does not matter', async () => {
      const client = makeDb()
      const buf = await archiveOf([{ table: 't', columns: ['a'], rows: [[1]] }])
      await restoreTenantDb(client as any, buf)

      const sql = client.queries.map(q => q.sql)
      expect(sql).toContain('BEGIN')
      expect(sql).toContain('SET session_replication_role = replica')
      expect(sql).toContain('SET session_replication_role = DEFAULT')
      expect(sql).toContain('COMMIT')
    })

    it('truncates each table before inserting (idempotent re-runs)', async () => {
      const client = makeDb()
      const buf = await archiveOf([{ table: 'orders', columns: ['a'], rows: [[1]] }])
      await restoreTenantDb(client as any, buf)
      expect(client.queries.map(q => q.sql)).toContain('TRUNCATE public."orders" CASCADE')
    })

    it('reports how many tables and rows were restored', async () => {
      const client = makeDb()
      const buf = await archiveOf([
        { table: 'a', columns: ['x'], rows: [[1], [2], [3]] },
        { table: 'b', columns: ['y'], rows: [[9]] },
      ])
      await expect(restoreTenantDb(client as any, buf)).resolves.toEqual({ tables: 2, rows: 4 })
    })

    it('still truncates a table that has no rows', async () => {
      const client = makeDb()
      const buf = await archiveOf([{ table: 'empty', columns: ['a'], rows: [] }])
      const out = await restoreTenantDb(client as any, buf)
      expect(out).toEqual({ tables: 1, rows: 0 })
      expect(client.queries.map(q => q.sql)).toContain('TRUNCATE public."empty" CASCADE')
      expect(client.queries.some(q => /INSERT INTO/.test(q.sql))).toBe(false)
    })

    it('binds parameters positionally for a multi-row insert', async () => {
      const client = makeDb()
      const buf = await archiveOf([
        {
          table: 't',
          columns: ['a', 'b'],
          rows: [
            [1, 2],
            [3, 4],
          ],
        },
      ])
      await restoreTenantDb(client as any, buf)
      const insert = client.queries.find(q => /INSERT INTO/.test(q.sql))!
      expect(insert.sql).toContain('($1, $2), ($3, $4)')
      expect(insert.params).toEqual([1, 2, 3, 4])
    })

    it('CHUNKS inserts to stay under the bind-parameter limit', async () => {
      const client = makeDb()
      // 1 column → chunk size is 60000; 60001 rows must split into 2 statements.
      const rows = Array.from({ length: 60001 }, (_, i) => [i])
      const buf = await archiveOf([{ table: 't', columns: ['a'], rows }])
      const out = await restoreTenantDb(client as any, buf)
      const inserts = client.queries.filter(q => /INSERT INTO/.test(q.sql))
      expect(inserts.length).toBe(2)
      expect(out.rows).toBe(60001)
    })

    it('ROLLS BACK and rethrows when a statement fails', async () => {
      const client = makeDb({ failOn: /INSERT INTO/ })
      const buf = await archiveOf([{ table: 't', columns: ['a'], rows: [[1]] }])
      await expect(restoreTenantDb(client as any, buf)).rejects.toThrow('boom')
      expect(client.queries.map(q => q.sql)).toContain('ROLLBACK')
    })

    it('checks out AND releases a client when given a pool', async () => {
      const client = makeDb()
      const pool = makePool(client)
      const buf = await archiveOf([{ table: 't', columns: ['a'], rows: [[1]] }])
      await restoreTenantDb(pool as any, buf)
      expect(pool.connect).toHaveBeenCalled()
      expect(client.release).toHaveBeenCalled()
    })

    it('releases the pooled client even when the restore fails', async () => {
      const client = makeDb({ failOn: /TRUNCATE/ })
      const pool = makePool(client)
      const buf = await archiveOf([{ table: 't', columns: ['a'], rows: [[1]] }])
      await expect(restoreTenantDb(pool as any, buf)).rejects.toThrow('boom')
      expect(client.release).toHaveBeenCalled()
    })

    it('rejects an unsafe identifier on the way back in', async () => {
      const client = makeDb()
      const buf = await archiveOf([{ table: 'bad"; DROP', columns: ['a'], rows: [[1]] }])
      await expect(restoreTenantDb(client as any, buf)).rejects.toThrow(/Unsafe identifier/)
    })
  })

  // -------------------------------------------------------------------------
  describe('round-trip', () => {
    it('preserves values through dump → restore, including bytea Buffers', async () => {
      const blob = Buffer.from([0xde, 0xad, 0xbe, 0xef])
      const source = makeDb({
        tables: ['docs'],
        data: { docs: { fields: ['id', 'name', 'blob'], rows: [{ id: 1, name: 'spec', blob }] } },
      })

      const archive = await dumpTenantDb(source as any, { database: 'jeffi_stores' })

      const target = makeDb()
      const out = await restoreTenantDb(target as any, archive)
      expect(out).toEqual({ tables: 1, rows: 1 })

      const insert = target.queries.find(q => /INSERT INTO/.test(q.sql))!
      expect(insert.params![0]).toBe(1)
      expect(insert.params![1]).toBe('spec')
      // The bytea survived JSON as a real Buffer, not {type:'Buffer',data:[…]}
      expect(Buffer.isBuffer(insert.params![2])).toBe(true)
      expect((insert.params![2] as Buffer).equals(blob)).toBe(true)
    })

    it('preserves null values', async () => {
      const source = makeDb({
        tables: ['t'],
        data: { t: { fields: ['a', 'b'], rows: [{ a: null, b: 'x' }] } },
      })
      const archive = await dumpTenantDb(source as any)
      const target = makeDb()
      await restoreTenantDb(target as any, archive)
      const insert = target.queries.find(q => /INSERT INTO/.test(q.sql))!
      expect(insert.params).toEqual([null, 'x'])
    })
  })
})
