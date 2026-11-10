import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import { NextRequest } from 'next/server'

const query = vi.fn()
vi.mock('@/lib/tenant-registry', () => ({
  controlPlanePool: () => ({ query }),
  getIntegrationCredential: vi.fn(),
  saveIntegrationCredential: vi.fn(),
  deleteIntegrationCredential: vi.fn(),
}))
vi.mock('@/lib/crypto/token-cipher', () => ({
  encryptToken: (s: string) => `enc:${s}`,
  decryptToken: (s: string) => s.replace(/^enc:/, ''),
}))
vi.mock('@/lib/catalog/brand', () => ({ storeBaseUrlAsync: async () => 'https://jeffistores.in' }))

import { POST } from '@storefront/app/api/(public)/meta/data-deletion/route'
import { readDeletionCode } from '@/lib/catalog/meta-privacy'

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')
function signed(payload: object, secret: string) {
  const p = b64url(JSON.stringify(payload))
  return `${b64url(crypto.createHmac('sha256', secret).update(p).digest())}.${p}`
}
const call = (sr: string, q = '') =>
  POST(
    new NextRequest(`https://jeffistores.in/api/meta/data-deletion${q}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ signed_request: sr }).toString(),
    })
  )
const OWN_ROW = { tenant_id: 't-own', config_enc: `enc:${JSON.stringify({ appId: '7770001', appSecret: 'own-secret' })}` }
const deletes = () => query.mock.calls.filter(c => String(c[0]).startsWith('DELETE'))

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(process.env, { META_APP_ID: '1000000002', META_APP_SECRET: 'platform-secret', CRON_SECRET: 'test-cron-secret-at-least-32-bytes!!!!' })
  query.mockImplementation(async (sql: string) => (String(sql).startsWith('SELECT') ? { rows: [OWN_ROW] } : { rowCount: 1 }))
})

describe('Meta data deletion callback', () => {
  it('deletes the user tokens for a request signed by the platform app and returns a working status URL', async () => {
    const r = await call(signed({ algorithm: 'HMAC-SHA256', user_id: 'fbu-1', issued_at: 1 }, 'platform-secret'))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.url).toBe(`https://jeffistores.in/meta/data-deletion?code=${encodeURIComponent(body.confirmation_code)}`)
    expect(readDeletionCode(body.confirmation_code)).toMatchObject({ deleted: 2 })
    expect(deletes()).toHaveLength(2)
    expect(deletes().every(c => c[1][0] === 'fbu-1' && c[1].length === 1)).toBe(true)
  })

  it("limits a store's own app to its own stores", async () => {
    const r = await call(signed({ algorithm: 'HMAC-SHA256', user_id: 'fbu-2' }, 'own-secret'), '?app=7770001')
    expect(r.status).toBe(200)
    expect(deletes().every(c => c[1][0] === 'fbu-2' && c[1][1][0] === 't-own')).toBe(true)
  })

  it('rejects a bad signature without deleting anything', async () => {
    const good = signed({ algorithm: 'HMAC-SHA256', user_id: 'fbu-1' }, 'platform-secret')
    const forged = `${b64url(crypto.randomBytes(32))}.${good.split('.')[1]}`
    expect((await call(forged)).status).toBe(400)
    expect(deletes()).toHaveLength(0)
  })

  it('rejects a request signed by an app it does not know', async () => {
    expect((await call(signed({ algorithm: 'HMAC-SHA256', user_id: 'fbu-1' }, 'someone-elses-secret'))).status).toBe(400)
    expect(deletes()).toHaveLength(0)
  })
})
