import { config } from 'dotenv'
config({ path: '.env.local' })
import { SignJWT } from 'jose'

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET)
const TEST_USER = { userId: process.env.SMOKE_USER_ID, email: process.env.SMOKE_USER_EMAIL }
if (!TEST_USER.userId || !TEST_USER.email) throw new Error('Set SMOKE_USER_ID and SMOKE_USER_EMAIL in .env.local')

const QUERIES = [
  'I need a car jack',
  'show me my orders',
  'recommend something based on what I bought',
  'what hammer drills do you have',
  'find products similar to a hex bolt',
  'do you have anything new this month',
]

async function mint() {
  return await new SignJWT(TEST_USER)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(JWT_SECRET)
}

const token = await mint()
console.log('# Customer Agent (tool-calling) — end-to-end smoke\n')
for (const q of QUERIES) {
  console.log(`## "${q}"`)
  const t0 = Date.now()
  const res = await fetch('http://localhost:3000/api/customer-agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `auth_token=${token}` },
    body: JSON.stringify({ message: q }),
  })
  const data = await res.json().catch(() => ({}))
  const ms = Date.now() - t0
  if (!res.ok) { console.log(`  ERROR ${res.status}: ${data.error || JSON.stringify(data).slice(0,200)}`); console.log(''); continue }
  console.log(`  provider=${data.provider} model=${data.model} ${ms}ms tools=${(data.toolCalls||[]).length}`)
  if (data.toolCalls?.length) {
    for (const tc of data.toolCalls) {
      const ok = tc.isError ? 'err' : 'ok'
      console.log(`    [${ok}] ${tc.tool}(${Object.keys(tc.input || {}).join(',')})`)
    }
  }
  console.log(`  reply: ${(data.message || '').slice(0, 300)}`)
  console.log('')
}
