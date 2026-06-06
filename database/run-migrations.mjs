/**
 * run-migrations.mjs
 * Runs all SQL migration files from database/migrations/ against the live RDS database.
 * All migrations use IF NOT EXISTS / idempotent patterns — safe to re-run.
 *
 * Requires SSH tunnel on port 5433:
 *   ssh -N -L 5433:jeffi-stores-db.cjmaa6acimgm.us-east-1.rds.amazonaws.com:5432 \
 *       ec2-user@32.196.38.130 -i ~/.ssh/jeffi-stores-key.pem
 *
 * Run: node database/run-migrations.mjs
 */

import pg from 'pg'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })

const RDS_MASTER_PASSWORD = process.env.RDS_MASTER_PASSWORD
if (!RDS_MASTER_PASSWORD) {
  console.error('RDS_MASTER_PASSWORD not set in .env.local')
  process.exit(1)
}

const client = new pg.Client({
  host:     '127.0.0.1',
  port:     5433,
  user:     'postgres',
  password: RDS_MASTER_PASSWORD,
  database: 'jeffi_stores',
  ssl:      { rejectUnauthorized: false },
})

const migrationsDir = path.resolve(__dirname, 'migrations')

const files = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .sort()

console.log(`Found ${files.length} migration files\n`)

await client.connect()

let passed = 0
let failed = 0

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8').trim()
  if (!sql) { console.log(`  SKIP  ${file} (empty)`); continue }

  process.stdout.write(`  RUN   ${file} ... `)
  try {
    await client.query(sql)
    console.log('OK')
    passed++
  } catch (err) {
    console.log(`FAILED\n        ${err.message}`)
    failed++
  }
}

await client.end()

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
