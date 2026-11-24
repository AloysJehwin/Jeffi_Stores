import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const { mockOwnerApi, mockRead, mockUpload, StorageCapExceededError } = vi.hoisted(() => ({
  mockOwnerApi: vi.fn(),
  mockRead: vi.fn(),
  mockUpload: vi.fn(),
  StorageCapExceededError: class extends Error {},
}))

vi.mock('@controller/lib/ecom/owner-api', () => ({ ownerApi: mockOwnerApi }))
vi.mock('@/lib/tenant-registry', () => ({ hasService: (t: { service_types: string[] }, s: string) => t.service_types.includes(s) }))
vi.mock('@jeffi/tenancy', () => ({ uploadTemplateAsset: mockUpload, StorageCapExceededError }))
vi.mock('@/lib/shared/form-file', () => ({ readUpload: mockRead }))

import { POST } from '@controller/app/api/(ecom)/ecom/messaging/assets/upload/route'

const req = () => new NextRequest('https://ecom.jeffistores.in/api/ecom/messaging/assets/upload', { method: 'POST' })
const upload = (over: Record<string, unknown> = {}) => ({ bytes: Buffer.from('png'), mime: 'image/png', field: (k: string) => (k === 'templateId' ? 'tpl-1' : null), ...over })

describe('POST /api/ecom/messaging/assets/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOwnerApi.mockResolvedValue({ owner: { id: 'o-1' }, tenant: { id: 't-1', service_types: ['messaging'] }, tenants: [] })
    mockRead.mockResolvedValue(upload())
  })

  it('returns the guard response when not signed in', async () => {
    mockOwnerApi.mockResolvedValue(NextResponse.json({ error: 'Not signed in' }, { status: 401 }))
    expect((await POST(req())).status).toBe(401)
  })

  it('403s a tenant without messaging', async () => {
    mockOwnerApi.mockResolvedValue({ owner: {}, tenant: { id: 't-1', service_types: ['store'] }, tenants: [] })
    expect((await POST(req())).status).toBe(403)
    expect(mockRead).not.toHaveBeenCalled()
  })

  it('400s a missing file and an unsupported type; 413s an oversize file', async () => {
    mockRead.mockResolvedValueOnce({ error: 'file required' })
    expect((await POST(req())).status).toBe(400)
    mockRead.mockResolvedValueOnce(upload({ mime: 'application/pdf' }))
    expect((await POST(req())).status).toBe(400)
    mockRead.mockResolvedValueOnce(upload({ bytes: Buffer.alloc(5 * 1024 * 1024 + 1) }))
    expect((await POST(req())).status).toBe(413)
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('uploads the asset and returns its url', async () => {
    mockUpload.mockResolvedValue({ url: 'https://cdn.test/a.png', key: 'k/a.png' })
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ url: 'https://cdn.test/a.png', key: 'k/a.png', bytes: 3, mime: 'image/png' })
    expect(mockUpload).toHaveBeenCalledWith(expect.any(Buffer), 'tpl-1', 'image/png')
  })

  it('413s when the storage cap is reached', async () => {
    mockUpload.mockRejectedValue(new StorageCapExceededError('cap'))
    const res = await POST(req())
    expect(res.status).toBe(413)
    expect((await res.json()).error).toContain('cap')
  })
})
