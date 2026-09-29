import { config } from 'dotenv'
config({ path: '.env.local' })
import { SignJWT } from 'jose'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)
const TEST_USER = { userId: process.env.SMOKE_USER_ID, email: process.env.SMOKE_USER_EMAIL }
if (!TEST_USER.userId || !TEST_USER.email) throw new Error('Set SMOKE_USER_ID and SMOKE_USER_EMAIL in .env.local')

const QUERIES = [
  'car jack',
  'plumbing tools',
  'wrench set',
  'I need to fix a leaking tap',
  'drilling concrete walls',
  'something to lift my car',
]

async function mint() {
  return await new SignJWT(TEST_USER)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(JWT_SECRET)
}

const token = await mint()
console.log('# Customer AI Assistant — end-to-end smoke\n')
for (const q of QUERIES) {
  console.log(`## "${q}"`)
  const t0 = Date.now()
  const res = await fetch('http://localhost:3000/api/ai-assistant/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${token}` },
    body: JSON.stringify({ query: q }),
  })
  const data = await res.json().catch(() => ({}))
  const ms = Date.now() - t0
  if (!res.ok) { console.log(`  ERROR ${res.status}: ${data.error || JSON.stringify(data).slice(0,100)}`); console.log(''); continue }
  console.log(`  source=${data.source} provider=${data.provider||'-'} model=${data.model||'-'} ${ms}ms`)
  console.log(`  summary: ${(data.summary || '').slice(0, 200)}`)
  if (data.recommendations?.length) {
    for (const r of data.recommendations.slice(0, 3)) {
      const p = r.product || r
      console.log(`    • ${p.name || JSON.stringify(r).slice(0,120)} (${p.sku || ''}) — ₹${p.base_price || ''}`)
    }
  } else {
    console.log('    (no products)')
  }
  console.log('')
}
