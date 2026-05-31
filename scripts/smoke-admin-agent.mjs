import { config } from 'dotenv'
config({ path: '.env.local' })
import { SignJWT } from 'jose'
import pg from 'pg'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })

async function adminToken() {
  const r = await pool.query("SELECT id::text, role, scopes FROM admins WHERE role = 'super_admin' LIMIT 1")
  const a = r.rows[0]
  await pool.end()
  return await new SignJWT({ adminId: a.id, role: a.role, scopes: a.scopes || [] })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(JWT_SECRET)
}

const QUERIES = [
  'show me the 5 most recent customers as a customer list',
  'show me 4 featured products as a product grid',
  'list 3 recent orders',
]

const token = await adminToken()
let conversationId = null
for (const q of QUERIES) {
  console.log('## "' + q + '"')
  const t0 = Date.now()
  const res = await fetch('http://localhost:3000/api/admin/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `admin_token=${token}` },
    body: JSON.stringify({ message: q, conversationId }),
  })
  const data = await res.json().catch(() => ({}))
  const ms = Date.now() - t0
  if (!res.ok) { console.log('  ERROR ' + res.status + ': ' + (data.error || JSON.stringify(data).slice(0,200))); continue }
  conversationId = data.conversationId
  console.log('  provider=' + data.provider + ' tools=' + (data.toolCalls||[]).length + ' actions=' + (data.proposedActions||[]).length + ' uiBlocks=' + (data.uiBlocks||[]).length + ' ' + ms + 'ms')
  for (const tc of (data.toolCalls||[])) {
    console.log('    [' + (tc.isError ? 'err' : 'ok') + '] ' + tc.tool)
  }
  console.log('  reply: ' + (data.message || ''))
  if (data.uiBlocks?.length) {
    console.log('  ui_blocks: ' + data.uiBlocks.map(b => `${b.type}(${Object.keys(b).filter(k=>k!=='type').join(',')})`).join(', '))
  }
  console.log('')
}
