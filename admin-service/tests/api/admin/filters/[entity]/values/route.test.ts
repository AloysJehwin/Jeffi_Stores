import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@jeffi/list-filters', () => ({ isValuesField: vi.fn(), normalizeQuery: vi.fn((_e: unknown, sp: URLSearchParams) => ({ ctx: sp.toString() })) }))
vi.mock('@/lib/auth/jwt', () => ({ requireAdminScope: vi.fn() }))
vi.mock('@/lib/filters/registry', () => ({ getEntity: vi.fn() }))
vi.mock('@/lib/filters/run', () => ({ getFilterValues: vi.fn() }))
vi.mock('@/lib/filters/window', () => ({ withDefaultWindow: vi.fn((_e: unknown, q: unknown) => q) }))

import { GET } from '@admin/app/api/(admin)/admin/filters/[entity]/values/route'
import { isValuesField } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getEntity } from '@/lib/filters/registry'
import { getFilterValues } from '@/lib/filters/run'

const ctx = { params: Promise.resolve({ entity: 'orders' }) }
const req = (qs: string) => new NextRequest(`http://localhost/api/admin/filters/orders/values${qs}`)

describe('GET filters/[entity]/values', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getEntity).mockReturnValue({ key: 'orders', scope: 'orders:read' } as any)
    vi.mocked(requireAdminScope).mockResolvedValue({ adminId: 'a1' } as any)
    vi.mocked(isValuesField).mockReturnValue(true as any)
    vi.mocked(getFilterValues).mockResolvedValue({ values: ['a'], hasMore: false } as any)
  })

  it('404s for an unknown list', async () => {
    vi.mocked(getEntity).mockReturnValue(undefined as any)
    expect((await GET(req('?field=x'), ctx)).status).toBe(404)
    expect(requireAdminScope).not.toHaveBeenCalled()
  })

  it('relays the entity scope rejection', async () => {
    vi.mocked(requireAdminScope).mockResolvedValue(NextResponse.json({ error: 'no' }, { status: 403 }))
    expect((await GET(req('?field=x'), ctx)).status).toBe(403)
    expect(requireAdminScope).toHaveBeenCalledWith(expect.anything(), 'orders:read')
  })

  it('400s on a field that is not value-helped', async () => {
    vi.mocked(isValuesField).mockReturnValue(false as any)
    expect((await GET(req('?field=x'), ctx)).status).toBe(400)
    expect(getFilterValues).not.toHaveBeenCalled()
  })

  it('400s when the runner rejects the field', async () => {
    vi.mocked(getFilterValues).mockResolvedValue(null as any)
    expect((await GET(req('?field=x'), ctx)).status).toBe(400)
  })

  it('returns the values with paging and context', async () => {
    const res = await GET(req('?field=status&search=pa&page=2&context=a%3D1'), ctx)
    expect(await res.json()).toEqual({ field: 'status', page: 2, values: ['a'], hasMore: false })
    expect(getFilterValues).toHaveBeenCalledWith(expect.anything(), 'status', { ctx: 'a=1' }, { search: 'pa', page: 2 })
  })

  it('skips the field check for custom entities', async () => {
    vi.mocked(getEntity).mockReturnValue({ key: 'x', scope: 's', custom: true } as any)
    vi.mocked(isValuesField).mockReturnValue(false as any)
    expect((await GET(req('?field=any'), ctx)).status).toBe(200)
  })

  it('500s when the runner throws', async () => {
    vi.mocked(getFilterValues).mockRejectedValue(new Error('db'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await GET(req('?field=x'), ctx)).status).toBe(500)
  })
})
