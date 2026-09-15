import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn().mockReturnValue(true) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const mockQuery = vi.fn()
const mockQueryOne = vi.fn()
const mockQueryMany = vi.fn()
const mockClientQuery = vi.fn()
vi.mock('@/lib/db', () => ({
  query: (...a: any[]) => mockQuery(...a),
  queryOne: (...a: any[]) => mockQueryOne(...a),
  queryMany: (...a: any[]) => mockQueryMany(...a),
  withTransaction: (fn: any) => fn({ query: (...a: any[]) => mockClientQuery(...a) }),
}))

import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { revalidatePath } from 'next/cache'
import { GET, POST, PATCH } from '@/app/api/admin/homepage-sections/route'
import { PATCH as PATCH_ONE, DELETE } from '@/app/api/admin/homepage-sections/[id]/route'

const admin = { id: 'a1', role: 'super_admin', scopes: [] }
const params = Promise.resolve({ id: 'sec-1' })

function req(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/admin/homepage-sections', {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  vi.mocked(hasScope).mockReturnValue(true)
})

describe('authorization', () => {
  it('401s every handler when unauthenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req('GET'))).status).toBe(401)
    expect((await POST(req('POST', { type: 'hero' }))).status).toBe(401)
    expect((await PATCH(req('PATCH', { order: ['a'] }))).status).toBe(401)
    expect((await PATCH_ONE(req('PATCH', { title: 'x' }), { params })).status).toBe(401)
    expect((await DELETE(req('DELETE'), { params })).status).toBe(401)
  })

  it('403s without the settings:write scope', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await GET(req('GET'))).status).toBe(403)
    expect((await POST(req('POST', { type: 'hero' }))).status).toBe(403)
    expect((await DELETE(req('DELETE'), { params })).status).toBe(403)
  })
})

describe('POST', () => {
  it('rejects an unknown section type', async () => {
    const res = await POST(req('POST', { type: 'definitely_not_a_section' }))
    expect(res.status).toBe(400)
  })

  it('appends after the highest display_order', async () => {
    mockQueryOne.mockResolvedValueOnce({ next: 7 }).mockResolvedValueOnce({ id: 's1' })
    const res = await POST(req('POST', { type: 'promo_banner', title: 'Diwali' }))
    expect(res.status).toBe(200)
    const insertParams = mockQueryOne.mock.calls[1][1]
    expect(insertParams).toContain(7)
  })

  it('serialises config as JSON', async () => {
    mockQueryOne.mockResolvedValueOnce({ next: 0 }).mockResolvedValueOnce({ id: 's1' })
    await POST(req('POST', { type: 'product_row', config: { source: 'best_sellers', limit: 4 } }))
    const insertParams = mockQueryOne.mock.calls[1][1]
    expect(insertParams).toContain(JSON.stringify({ source: 'best_sellers', limit: 4 }))
  })

  it('revalidates the homepage so edits appear immediately', async () => {
    mockQueryOne.mockResolvedValueOnce({ next: 0 }).mockResolvedValueOnce({ id: 's1' })
    await POST(req('POST', { type: 'benefits' }))
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/')
  })
})

describe('PATCH reorder', () => {
  it('requires a non-empty order array', async () => {
    expect((await PATCH(req('PATCH', { order: [] }))).status).toBe(400)
  })

  it('reorders in a single atomic statement', async () => {
    mockClientQuery.mockResolvedValue({})
    const res = await PATCH(req('PATCH', { order: ['a', 'b', 'c'] }))
    expect(res.status).toBe(200)
    expect(mockClientQuery).toHaveBeenCalledTimes(1)
    const [sql, p] = mockClientQuery.mock.calls[0]
    expect(sql).toContain('WITH ORDINALITY')
    expect(p[0]).toEqual(['a', 'b', 'c'])
  })
})

describe('PATCH one', () => {
  it('maps camelCase fields to columns', async () => {
    mockQueryOne.mockResolvedValue({ id: 'sec-1' })
    await PATCH_ONE(req('PATCH', { ctaLabel: 'Shop', isActive: false }), { params })
    const [sql] = mockQueryOne.mock.calls[0]
    expect(sql).toContain('cta_label = $1')
    expect(sql).toContain('is_active = $2')
  })

  it('refuses a body with no known fields', async () => {
    const res = await PATCH_ONE(req('PATCH', {}), { params })
    expect(res.status).toBe(400)
  })

  // Changing type would orphan the config, so it is not patchable by design.
  it('ignores an attempt to change the section type', async () => {
    mockQueryOne.mockResolvedValue({ id: 'sec-1' })
    const res = await PATCH_ONE(req('PATCH', { type: 'hero', title: 'x' }), { params })
    expect(res.status).toBe(200)
    const [sql] = mockQueryOne.mock.calls[0]
    expect(sql).not.toContain('type =')
  })

  it('404s an unknown id', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await PATCH_ONE(req('PATCH', { title: 'x' }), { params })
    expect(res.status).toBe(404)
  })
})

describe('DELETE', () => {
  it('deletes and revalidates', async () => {
    mockQuery.mockResolvedValue({})
    const res = await DELETE(req('DELETE'), { params })
    expect(res.status).toBe(200)
    expect(mockQuery.mock.calls[0][0]).toContain('DELETE FROM homepage_sections')
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith('/')
  })
})
