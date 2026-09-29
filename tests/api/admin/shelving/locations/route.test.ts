import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shelf', () => ({
  listLocations: vi.fn(),
  createLocation: vi.fn(),
}))
vi.mock('@/lib/validate', () => ({
  parseBody: vi.fn(),
  zNonEmpty: 'zNonEmpty',
  zUuid: 'zUuid',
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { GET, POST } from '@/app/api/admin/shelving/locations/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { listLocations, createLocation } from '@/lib/shelf'
import { parseBody } from '@/lib/validate'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['inventory'] }

function makeGet(qs = '') {
  return new NextRequest(`http://localhost/api/admin/shelving/locations${qs}`)
}

function makePost(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/shelving/locations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const LOCATION = { id: 'loc-1', aisle_code: 'A', rack_code: 'R1', shelf_code: 'S1', bin_code: null }

// ── GET tests ─────────────────────────────────────────────────────────────────

describe('GET /api/admin/shelving/locations', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 403 when missing inventory scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await GET(makeGet())
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Forbidden' })
  })

  it('returns locations without warehouse filter', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(listLocations).mockResolvedValue([LOCATION] as any)
    const res = await GET(makeGet())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.locations).toHaveLength(1)
    expect(vi.mocked(listLocations)).toHaveBeenCalledWith(undefined)
  })

  it('passes warehouse_id query param to listLocations', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(listLocations).mockResolvedValue([])
    await GET(makeGet('?warehouse_id=wh-1'))
    expect(vi.mocked(listLocations)).toHaveBeenCalledWith('wh-1')
  })

  it('returns 500 on db error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(listLocations).mockRejectedValue(new Error('db error'))
    const res = await GET(makeGet())
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'db error' })
  })
})

// ── POST tests ────────────────────────────────────────────────────────────────

describe('POST /api/admin/shelving/locations', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const VALID_BODY = {
    warehouse_id: 'wh-1',
    aisle_code: 'A1',
    rack_code: 'R1',
    shelf_code: 'S1',
    bin_code: 'B1',
    notes: 'test note',
  }

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(403)
  })

  it('returns 400 when warehouse_id missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({ aisle_code: 'A', rack_code: 'R', shelf_code: 'S' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'warehouse_id required' })
  })

  it('returns 400 when aisle_code missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({ warehouse_id: 'wh-1', aisle_code: '  ', rack_code: 'R', shelf_code: 'S' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'aisle_code required' })
  })

  it('returns 400 when rack_code missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({ warehouse_id: 'wh-1', aisle_code: 'A', rack_code: '', shelf_code: 'S' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'rack_code required' })
  })

  it('returns 400 when shelf_code missing', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const res = await POST(makePost({ warehouse_id: 'wh-1', aisle_code: 'A', rack_code: 'R', shelf_code: '' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'shelf_code required' })
  })

  it('returns parseBody response when validation fails', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    const fakeResponse = Response.json({ error: 'invalid' }, { status: 422 })
    vi.mocked(parseBody).mockReturnValue({ ok: false, response: fakeResponse } as any)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(422)
  })

  it('creates location on valid data and returns 201', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(parseBody).mockReturnValue({ ok: true } as any)
    vi.mocked(createLocation).mockResolvedValue(LOCATION as any)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.location).toEqual(LOCATION)
    expect(vi.mocked(createLocation)).toHaveBeenCalledWith(
      'wh-1', 'A1', 'R1', 'S1', 'B1', 'test note'
    )
  })

  it('creates location with null bin_code and notes when omitted', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(parseBody).mockReturnValue({ ok: true } as any)
    vi.mocked(createLocation).mockResolvedValue(LOCATION as any)
    const res = await POST(makePost({ warehouse_id: 'wh-1', aisle_code: 'A', rack_code: 'R', shelf_code: 'S' }))
    expect(res.status).toBe(201)
    expect(vi.mocked(createLocation)).toHaveBeenCalledWith('wh-1', 'A', 'R', 'S', null, null)
  })

  it('returns 409 on unique violation (message contains unique)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(parseBody).mockReturnValue({ ok: true } as any)
    vi.mocked(createLocation).mockRejectedValue(Object.assign(new Error('unique constraint'), { code: '23505' }))
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'Location already exists' })
  })

  it('returns 409 on error code 23505', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(parseBody).mockReturnValue({ ok: true } as any)
    const err = Object.assign(new Error('dup'), { code: '23505' })
    vi.mocked(createLocation).mockRejectedValue(err)
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(409)
  })

  it('returns 404 on Warehouse not found error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(parseBody).mockReturnValue({ ok: true } as any)
    vi.mocked(createLocation).mockRejectedValue(new Error('Warehouse not found'))
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(404)
  })

  it('returns 500 on generic error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(parseBody).mockReturnValue({ ok: true } as any)
    vi.mocked(createLocation).mockRejectedValue(new Error('db connection lost'))
    const res = await POST(makePost(VALID_BODY))
    expect(res.status).toBe(500)
  })
})
