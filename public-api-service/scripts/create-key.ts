// Dev helper: create an API key for an owner+tenant. Usage: TENANT_SLUG=testco OWNER_EMAIL=x@y npx tsx scripts/create-key.ts
import { cp, generateKey } from '../src/keys.js'
import { API_SCOPES } from '@jeffi/api-contracts'

const slug = process.env.TENANT_SLUG
const email = process.env.OWNER_EMAIL
if (!slug || !email) throw new Error('TENANT_SLUG and OWNER_EMAIL required')
const { rows } = await cp().query(
  `SELECT o.id AS owner_id, t.id AS tenant_id FROM owners o JOIN owner_tenants ot ON ot.owner_id=o.id JOIN tenants t ON t.id=ot.tenant_id WHERE o.email=$1 AND t.slug=$2`,
  [email, slug]
)
if (!rows[0]) throw new Error('owner/tenant not linked')
const g = generateKey()
await cp().query(`INSERT INTO api_keys (owner_id, tenant_id, name, key_prefix, key_hash, scopes) VALUES ($1,$2,$3,$4,$5,$6)`, [
  rows[0].owner_id, rows[0].tenant_id, process.env.KEY_NAME ?? 'dev', g.prefix, g.hash, [...API_SCOPES],
])
console.log(g.plain)
process.exit(0)
