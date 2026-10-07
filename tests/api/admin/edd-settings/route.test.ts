import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({
  getBusinessValues: vi.fn(),
  invalidateSiteControlsCache: vi.fn(),
}))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(async () => null) }))
vi.mock('@/lib/shipping/delhivery', () => ({
  listDelhiveryPickupLocations: vi.fn(),
  setDefaultPickupLocation: vi.fn(),
}))

import { GET, PUT } from '@/app/api/(admin)/admin/edd-settings/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'
import { getBusinessValues, invalidateSiteControlsCache } from '@/lib/catalog/site-controls'
import { listDelhiveryPickupLocations, setDefaultPickupLocation } from '@/lib/shipping/delhivery'
import { EDD_DEFAULTS } from '@/lib/shipping/edd'

const admin = { adminId: 'a1', role: 'admin', scopes: ['settings:write'] }
const bv = { delhiveryOriginPincode: '492001', pickupLocation: 'Raipur WH', eddSettingsJson: '' }

const put = (body: unknown) =>
  PUT(
    new NextRequest('http://localhost/api/admin/edd-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue(admin as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(getBusinessValues).mockResolvedValue(bv as any)
  vi.mocked(query).mockResolvedValue({ rows: [] } as any)
  vi.mocked(listDelhiveryPickupLocations).mockResolvedValue([
    { name: 'Raipur WH', pin: '492001', phone: '', address: '', city: 'Raipur', state: 'CG', active: true },
    { name: 'Pune WH', pin: '411001', phone: '', address: '', city: 'Pune', state: 'MH', active: true },
  ])
})

describe('GET /api/admin/edd-settings', () => {
  it('401 without a session, 403 without settings:read', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await GET(new NextRequest('http://localhost/x'))).status).toBe(401)
    vi.mocked(hasScope).mockReturnValueOnce(false)
    expect((await GET(new NextRequest('http://localhost/x'))).status).toBe(403)
  })
  it('returns defaults, the default warehouse and the warehouse list', async () => {
    const res = await GET(new NextRequest('http://localhost/x'))
    const d = await res.json()
    expect(d.settings).toEqual(EDD_DEFAULTS)
    expect(d.defaultWarehouse).toBe('Raipur WH')
    expect(d.originPin).toBe('492001')
    expect(d.warehouses.map((w: any) => w.name)).toEqual(['Raipur WH', 'Pune WH'])
  })
})

describe('PUT /api/admin/edd-settings', () => {
  it('403 without settings:write', async () => {
    vi.mocked(hasScope).mockReturnValueOnce(false)
    expect((await put({ settings: EDD_DEFAULTS })).status).toBe(403)
  })
  it('400 on invalid settings and writes nothing', async () => {
    const res = await put({ settings: { ...EDD_DEFAULTS, metroDays: -2 } })
    expect(res.status).toBe(400)
    expect(query).not.toHaveBeenCalled()
  })
  it('stores the validated JSON and busts the site-controls cache', async () => {
    const settings = { ...EDD_DEFAULTS, remoteDays: 18, metroPrefixes: ['110', '110'] }
    const res = await put({ settings })
    expect(res.status).toBe(200)
    const [sql, params] = vi.mocked(query).mock.calls[0]
    expect(sql).toMatch(/'edd_settings'/)
    expect(JSON.parse(params![0] as string)).toEqual({ ...settings, metroPrefixes: ['110'] })
    expect(invalidateSiteControlsCache).toHaveBeenCalled()
    expect(setDefaultPickupLocation).not.toHaveBeenCalled()
  })
  it('switches the default warehouse when a different one is picked', async () => {
    vi.mocked(setDefaultPickupLocation).mockResolvedValueOnce({ ok: true })
    const res = await put({ settings: EDD_DEFAULTS, defaultWarehouse: 'Pune WH' })
    expect(res.status).toBe(200)
    expect(setDefaultPickupLocation).toHaveBeenCalledWith('Pune WH', undefined)
  })
  it('400 when the warehouse cannot be set', async () => {
    vi.mocked(setDefaultPickupLocation).mockResolvedValueOnce({ ok: false, error: 'Warehouse not found' })
    const res = await put({ settings: EDD_DEFAULTS, defaultWarehouse: 'Ghost' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('Warehouse not found')
    expect(query).not.toHaveBeenCalled()
  })
})
