import pg from 'pg'

const url = process.env.MESSAGING_DATABASE_URL
if (!url) throw new Error('MESSAGING_DATABASE_URL is not set')
export const db = new pg.Pool({ connectionString: url, max: 10 })

export const q = <T extends pg.QueryResultRow = any>(text: string, params?: unknown[]) => db.query<T>(text, params).then(r => r.rows)
export const one = <T extends pg.QueryResultRow = any>(text: string, params?: unknown[]) => db.query<T>(text, params).then(r => r.rows[0] as T | undefined)
