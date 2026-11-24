import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'node:crypto'

const { mockOwnerApi, mockQuery } = vi.hoisted(() => ({ mockOwnerApi: vi.fn(), mockQuery: vi.fn() }))

vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: mockOwnerApi }))
vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query: mockQuery }) }))

import { GET, POST } from '@controller/app/api/(ecom)/ecom/api-keys/route'

const url = 'https://ecom.jeffistores.in/api/ecom/api-keys'
const post = (body: unknown) => new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })

describe('/api/ecom/api-keys', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwnerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 't-1' }, tenants: [] })
  })

  it('rejects an unauthenticated caller on GET and POST', async () => {
    mockOwnerApi.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await GET(new NextRequest(url))).status).toBe(401)
    expect((await POST(post({ name: 'k', scopes: ['messages:send'] }))).status).toBe(401)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('lists the tenant keys', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'k-1', name: 'main' }] })
    const res = await GET(new NextRequest(url))
    expect(await res.json()).toEqual({ keys: [{ id: 'k-1', name: 'main' }] })
    expect(mockQuery.mock.calls[0][1]).toEqual(['t-1'])
  })

  it('400s a body with no scopes or an unknown scope', async () => {
    expect((await POST(post({ name: 'k', scopes: [] }))).status).toBe(400)
    expect((await POST(post({ name: 'k', scopes: ['root'] }))).status).toBe(400)
    expect(mockQuery).not.toHaveBeenCalled()
  })

  it('creates a key, stores only its hash and returns the plaintext once', async () => {
    mockQuery.mockResolvedValue({ rows: [{ id: 'k-9', key_prefix: 'jk_live_abcdefgh', created_at: 'now' }] })
    const res = await POST(post({ name: 'ci', scopes: ['messages:send'] }))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.key).toMatch(/^jk_live_/)
    const args = mockQuery.mock.calls[0][1]
    expect(args[0]).toBe('o-1')
    expect(args[1]).toBe('t-1')
    expect(args[4]).toBe(createHash('sha256').update(body.key).digest('hex'))
    expect(args[4]).not.toBe(body.key)
    expect(args[5]).toEqual(['messages:send'])
  })

  it('propagates a database failure', async () => {
    mockQuery.mockRejectedValue(new Error('db down'))
    await expect(POST(post({ name: 'ci', scopes: ['wallet:read'] }))).rejects.toThrow('db down')
  })
})
