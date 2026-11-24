import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'node:crypto'
import { NextRequest } from 'next/server'

const SECRET = 'test-meta-app-secret'
const deleteMetaUserData = vi.hoisted(() => vi.fn())

// Real signature parsing over a test secret; only the secret lookup and the DB delete are stubbed.
vi.mock('@/lib/catalog/meta-privacy', async () => {
  const actual = await vi.importActual<typeof import('@/lib/catalog/meta-privacy')>('@/lib/catalog/meta-privacy')
  return {
    ...actual,
    verifyMetaSignedRequest: async (signed: string) => {
      const d = actual.parseSignedRequest(signed, SECRET)
      return d ? { userId: d.user_id, source: 'platform', tenantIds: null } : null
    },
    deleteMetaUserData,
  }
})

import { POST } from '@storefront/app/api/(public)/meta/deauthorize/route'

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url')
function sign(payload: object, secret = SECRET) {
  const p = b64url(JSON.stringify(payload))
  return `${b64url(crypto.createHmac('sha256', secret).update(p).digest())}.${p}`
}
const post = (signed?: string) =>
  POST(
    new NextRequest('http://localhost/api/meta/deauthorize', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: signed === undefined ? '' : new URLSearchParams({ signed_request: signed }).toString(),
    })
  )

describe('POST /api/meta/deauthorize', () => {
  beforeEach(() => {
    deleteMetaUserData.mockResolvedValue(2)
  })

  it('400s without a signed_request', async () => {
    const res = await post()
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Missing signed_request')
  })

  it('400s on a bad signature and deletes nothing', async () => {
    const res = await post(sign({ algorithm: 'HMAC-SHA256', user_id: '77' }, 'wrong-secret'))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Invalid signed_request')
    expect(deleteMetaUserData).not.toHaveBeenCalled()
  })

  it('deletes the user data on a validly signed request', async () => {
    const res = await post(sign({ algorithm: 'HMAC-SHA256', user_id: 77 }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, deleted: 2 })
    expect(deleteMetaUserData).toHaveBeenCalledWith('77', null)
  })

  it('503s so Meta retries when deletion fails', async () => {
    deleteMetaUserData.mockRejectedValue(new Error('db'))
    const res = await post(sign({ algorithm: 'HMAC-SHA256', user_id: '77' }))
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('retry')
  })
})
