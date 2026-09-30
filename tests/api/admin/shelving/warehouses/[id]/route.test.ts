import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (must precede imports) ───────────────────────────────────────────

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/catalog/shelf', () => ({
  updateWarehouse: vi.fn(),
  deleteWarehouse: vi.fn(),
}))

// ── Imports ────────────────────────────────────────────────────────────────

import { PATCH, DELETE } from '@/app/api/(admin)/admin/shelving/warehouses/[id]/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { updateWarehouse, deleteWarehouse } from '@/lib/catalog/shelf'

// ── Helpers ────────────────────────────────────────────────────────────────

const ADMIN = { adminId: 'admin-1', role: 'super_admin', scopes: ['inventory'] }
const WH_ID = 'wh-uuid-1'
const PARAMS = { params: Promise.resolve({ id: WH_ID }) }

function makePatch(body: object) {
  return new NextRequest(`http://localhost/api/admin/shelving/warehouses/${WH_ID}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeDelete() {
  return new NextRequest(`http://localhost/api/admin/shelving/warehouses/${WH_ID}`, {
    method: 'DELETE',
  })
}

const mockAuth = vi.mocked(authenticateAdmin)
const mockHasScope = vi.mocked(hasScope)
const mockUpdateWarehouse = vi.mocked(updateWarehouse)
const mockDeleteWarehouse = vi.mocked(deleteWarehouse)

const WAREHOUSE = { id: WH_ID, name: 'Main Warehouse', code: 'MAIN', is_active: true }

// ── Tests ──────────────────────────────────────────────────────────────────

describe('PATCH /api/admin/shelving/warehouses/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockUpdateWarehouse.mockResolvedValue(WAREHOUSE as any)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await PATCH(makePatch({ name: 'Test' }), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when inventory scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await PATCH(makePatch({ name: 'Test' }), PARAMS)
    expect(res.status).toBe(403)
  })

  it('updates warehouse and returns it', async () => {
    const res = await PATCH(makePatch({ name: 'Updated WH', code: 'UPD', is_active: false }), PARAMS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.warehouse.id).toBe(WH_ID)
    expect(mockUpdateWarehouse).toHaveBeenCalledWith(WH_ID, expect.objectContaining({ name: 'Updated WH' }))
  })

  it('trims name and code fields', async () => {
    await PATCH(makePatch({ name: '  Warehouse A  ', code: '  WHA  ' }), PARAMS)
    expect(mockUpdateWarehouse).toHaveBeenCalledWith(
      WH_ID,
      expect.objectContaining({
        name: 'Warehouse A',
        code: 'WHA',
      })
    )
  })

  it('sets address to null when empty string provided', async () => {
    await PATCH(makePatch({ name: 'WH', address: '   ' }), PARAMS)
    expect(mockUpdateWarehouse).toHaveBeenCalledWith(WH_ID, expect.objectContaining({ address: null }))
  })

  it('returns 404 when warehouse not found', async () => {
    mockUpdateWarehouse.mockRejectedValue(new Error('Warehouse not found'))
    const res = await PATCH(makePatch({ name: 'X' }), PARAMS)
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('Warehouse not found')
  })

  it('returns 500 on other update errors', async () => {
    mockUpdateWarehouse.mockRejectedValue(new Error('DB error'))
    const res = await PATCH(makePatch({ name: 'X' }), PARAMS)
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('DB error')
  })
})

describe('DELETE /api/admin/shelving/warehouses/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockAuth.mockResolvedValue(ADMIN as any)
    mockHasScope.mockReturnValue(true)
    mockDeleteWarehouse.mockResolvedValue(undefined)
  })

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue(null)
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(401)
  })

  it('returns 403 when inventory scope missing', async () => {
    mockHasScope.mockReturnValue(false)
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(403)
  })

  it('deletes warehouse and returns ok:true', async () => {
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(200)
    expect((await res.json()).ok).toBe(true)
    expect(mockDeleteWarehouse).toHaveBeenCalledWith(WH_ID)
  })

  it('returns 409 when warehouse cannot be deleted (has stock)', async () => {
    mockDeleteWarehouse.mockRejectedValue(new Error('Cannot delete warehouse: it has stock'))
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Cannot delete/)
  })

  it('returns 500 on other delete errors', async () => {
    mockDeleteWarehouse.mockRejectedValue(new Error('Unexpected failure'))
    const res = await DELETE(makeDelete(), PARAMS)
    expect(res.status).toBe(500)
  })
})
