import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (before imports) ────────────────────────────────────────────────────

vi.mock('@/lib/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shelf', () => ({
  updateLocation: vi.fn(),
  deleteLocation: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────────────────────

import { PATCH, DELETE } from '@/app/api/admin/shelving/locations/[id]/route'
import { authenticateAdmin } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { updateLocation, deleteLocation } from '@/lib/shelf'

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'a1', role: 'admin', scopes: ['inventory'] }
const PARAMS = { params: { id: 'loc-123' } }
const LOCATION = { id: 'loc-123', aisle_code: 'A', rack_code: 'R1', shelf_code: 'S1' }

function makePatch(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/shelving/locations/loc-123', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDelete() {
  return new NextRequest('http://localhost/api/admin/shelving/locations/loc-123', {
    method: 'DELETE',
  })
}

// ── PATCH tests ───────────────────────────────────────────────────────────────

describe('PATCH /api/admin/shelving/locations/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await PATCH(makePatch({}), PARAMS)
    expect(res.status).toBe(401)
    expect(await res.json()).toMatchObject({ error: 'Unauthorized' })
  })

  it('returns 403 when missing inventory scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await PATCH(makePatch({}), PARAMS)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: 'Forbidden' })
  })

  it('updates all provided fields and returns location', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(updateLocation).mockResolvedValue(LOCATION as any)
    const body = {
      aisle_code: 'B',
      rack_code: 'R2',
      shelf_code: 'S2',
      bin_code: 'B1',
      notes: 'updated',
      is_active: true,
    }
    const res = await PATCH(makePatch(body), PARAMS)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.location).toEqual(LOCATION)
    expect(vi.mocked(updateLocation)).toHaveBeenCalledWith('loc-123', {
      aisle_code: 'B',
      rack_code: 'R2',
      shelf_code: 'S2',
      bin_code: 'B1',
      notes: 'updated',
      is_active: true,
    })
  })

  it('sets bin_code to null when empty string provided', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(updateLocation).mockResolvedValue(LOCATION as any)
    await PATCH(makePatch({ bin_code: '  ' }), PARAMS)
    const call = vi.mocked(updateLocation).mock.calls[0][1]
    expect(call.bin_code).toBeNull()
  })

  it('sets notes to null when empty string provided', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(updateLocation).mockResolvedValue(LOCATION as any)
    await PATCH(makePatch({ notes: '' }), PARAMS)
    const call = vi.mocked(updateLocation).mock.calls[0][1]
    expect(call.notes).toBeNull()
  })

  it('does not set fields that are not in body', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(updateLocation).mockResolvedValue(LOCATION as any)
    await PATCH(makePatch({ aisle_code: 'X' }), PARAMS)
    const call = vi.mocked(updateLocation).mock.calls[0][1]
    expect(call).not.toHaveProperty('rack_code')
    expect(call).not.toHaveProperty('shelf_code')
    expect(call).not.toHaveProperty('bin_code')
  })

  it('returns 404 on Location not found', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(updateLocation).mockRejectedValue(new Error('Location not found'))
    const res = await PATCH(makePatch({ aisle_code: 'A' }), PARAMS)
    expect(res.status).toBe(404)
  })

  it('returns 500 on other error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(updateLocation).mockRejectedValue(new Error('db timeout'))
    const res = await PATCH(makePatch({ aisle_code: 'A' }), PARAMS)
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({ error: 'db timeout' })
  })
})

// ── DELETE tests ──────────────────────────────────────────────────────────────

describe('DELETE /api/admin/shelving/locations/[id]', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns 401 when not authenticated', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(null as any)
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when missing inventory scope', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(false)
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('deletes location and returns ok', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(deleteLocation).mockResolvedValue(undefined)
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true })
    expect(vi.mocked(deleteLocation)).toHaveBeenCalledWith('loc-123')
  })

  it('returns 409 when location has stock (Cannot delete)', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(deleteLocation).mockRejectedValue(new Error('Cannot delete location with existing stock'))
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'Cannot delete location with existing stock' })
  })

  it('returns 500 on other error', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValue(ADMIN as any)
    vi.mocked(hasScope).mockReturnValue(true)
    vi.mocked(deleteLocation).mockRejectedValue(new Error('unexpected failure'))
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(500)
  })
})
