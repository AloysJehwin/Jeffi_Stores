import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getStoreIdentity: vi.fn() }))

import { GET, POST } from '@admin/app/api/(admin)/admin/template-variables/route'
import { PATCH, DELETE } from '@admin/app/api/(admin)/admin/template-variables/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne, queryMany } from '@/lib/shared/db'

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['settings'] }
const ID = '11111111-1111-4111-8111-111111111111'

function req(method: string, url: string, body?: unknown) {
  return new NextRequest(`http://localhost/api/admin/template-variables${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const params = (id = ID) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(queryMany).mockResolvedValue([
    { id: ID, key: 'support_hours', label: 'Support hours', description: null, value: '9-6', is_enabled: true },
  ] as any)
})

describe('GET /api/admin/template-variables', () => {
  it('401 without a session', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    expect((await GET(req('GET', ''))).status).toBe(401)
  })

  it('lists built-ins and custom for any authenticated admin', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(req('GET', ''))
    expect(res.status).toBe(200)
    const d = await res.json()
    expect(d.variables.some((v: any) => v.key === 'store_name' && v.builtIn)).toBe(true)
    expect(d.variables.some((v: any) => v.key === 'support_hours' && !v.builtIn)).toBe(true)
    expect(d.custom).toEqual([
      { id: ID, key: 'support_hours', label: 'Support hours', description: '', value: '9-6', isEnabled: true },
    ])
  })
})

describe('POST /api/admin/template-variables', () => {
  it('403 without settings:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await POST(req('POST', '', { key: 'x', label: 'X' }))).status).toBe(403)
    expect(hasScope).toHaveBeenCalledWith('admin', ['settings'], 'settings:write')
  })

  it('rejects a bad key format', async () => {
    for (const key of ['Bad-Key', '1abc', 'has space', '']) {
      const res = await POST(req('POST', '', { key, label: 'X' }))
      expect(res.status).toBe(400)
    }
    expect(queryOne).not.toHaveBeenCalled()
  })

  it('rejects a built-in key', async () => {
    const res = await POST(req('POST', '', { key: 'store_name', label: 'Mine' }))
    expect(res.status).toBe(400)
    expect(JSON.stringify(await res.json())).toContain('built-in')
  })

  it('requires a label', async () => {
    expect((await POST(req('POST', '', { key: 'promo' }))).status).toBe(400)
  })

  it('creates a variable', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: ID } as any)
    const res = await POST(req('POST', '', { key: 'promo_line', label: 'Promo', value: 'Free shipping' }))
    expect(res.status).toBe(201)
    expect(vi.mocked(queryOne).mock.calls[0][1]).toEqual(['promo_line', 'Promo', '', 'Free shipping', true])
  })

  it('409 on a duplicate key', async () => {
    vi.mocked(queryOne).mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }))
    expect((await POST(req('POST', '', { key: 'promo_line', label: 'Promo' }))).status).toBe(409)
  })
})

describe('PATCH /api/admin/template-variables/[id]', () => {
  it('403 without settings:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await PATCH(req('PATCH', `/${ID}`, { label: 'X' }), params())).status).toBe(403)
  })

  it('400 on a non-uuid id', async () => {
    expect((await PATCH(req('PATCH', '/nope', { label: 'X' }), params('nope'))).status).toBe(400)
  })

  it('rejects renaming onto a built-in key', async () => {
    expect((await PATCH(req('PATCH', `/${ID}`, { key: 'customer_email' }), params())).status).toBe(400)
  })

  it('rejects an empty update', async () => {
    expect((await PATCH(req('PATCH', `/${ID}`, {}), params())).status).toBe(400)
  })

  it('updates only the given fields', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: ID } as any)
    const res = await PATCH(req('PATCH', `/${ID}`, { value: 'new', isEnabled: false }), params())
    expect(res.status).toBe(200)
    const [sql, values] = vi.mocked(queryOne).mock.calls[0]
    expect(sql).toContain('value = $1, is_enabled = $2')
    expect(values).toEqual(['new', false, ID])
  })

  it('404 when missing', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    expect((await PATCH(req('PATCH', `/${ID}`, { value: 'x' }), params())).status).toBe(404)
  })

  it('409 on a duplicate key', async () => {
    vi.mocked(queryOne).mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }))
    expect((await PATCH(req('PATCH', `/${ID}`, { key: 'taken' }), params())).status).toBe(409)
  })
})

describe('DELETE /api/admin/template-variables/[id]', () => {
  it('403 without settings:write', async () => {
    vi.mocked(hasScope).mockReturnValue(false)
    expect((await DELETE(req('DELETE', `/${ID}`), params())).status).toBe(403)
  })

  it('deletes', async () => {
    vi.mocked(queryOne).mockResolvedValue({ id: ID } as any)
    expect((await DELETE(req('DELETE', `/${ID}`), params())).status).toBe(200)
  })

  it('404 when missing', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    expect((await DELETE(req('DELETE', `/${ID}`), params())).status).toBe(404)
  })
})
