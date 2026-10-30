import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ getBusinessValues: vi.fn() }))
vi.mock('@/lib/tenancy/tenant-context', () => ({ resolveTenantId: vi.fn(async () => null) }))
vi.mock('@/lib/shipping/delhivery', () => ({ listDelhiveryPickupLocations: vi.fn() }))

import { POST } from '@admin/app/api/(admin)/admin/edd-settings/preview/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { getBusinessValues } from '@/lib/catalog/site-controls'
import { listDelhiveryPickupLocations } from '@/lib/shipping/delhivery'
import { EDD_DEFAULTS, computeEdd } from '@/lib/shipping/edd'

const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/admin/edd-settings/preview', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  )

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a', role: 'admin', scopes: [] } as any)
  vi.mocked(hasScope).mockReturnValue(true)
  vi.mocked(getBusinessValues).mockResolvedValue({
    delhiveryOriginPincode: '492001',
    pickupLocation: 'Raipur WH',
    eddSettingsJson: JSON.stringify({ metroDays: 9 }),
  } as any)
  vi.mocked(listDelhiveryPickupLocations).mockResolvedValue([
    { name: 'Pune WH', pin: '411001', phone: '', address: '', city: '', state: '', active: true },
  ])
})

describe('POST /api/admin/edd-settings/preview', () => {
  it('401 / 403 / 400 guards', async () => {
    vi.mocked(authenticateAdmin).mockResolvedValueOnce(null)
    expect((await post({ pin: '600001' })).status).toBe(401)
    vi.mocked(hasScope).mockReturnValueOnce(false)
    expect((await post({ pin: '600001' })).status).toBe(403)
    expect((await post({ pin: '6000' })).status).toBe(400)
    expect((await post({ pin: '600001', settings: { ...EDD_DEFAULTS, restDays: 'x' } })).status).toBe(400)
  })
  it('uses the saved settings: zone, days and the same date computeEdd gives checkout', async () => {
    const d = await (await post({ pin: '600001' })).json()
    expect(d.zone).toBe('metro')
    expect(d.zoneLabel).toBe('Metro')
    expect(d.transitDays).toBe(9)
    expect(d.totalDays).toBe(11)
    expect(d.edd).toBe(
      computeEdd({ pin: '600001', store: { delhiveryOriginPincode: '492001', eddSettingsJson: '{"metroDays":9}' } })
    )
    expect(d.state).toBe('Tamil Nadu')
  })
  it('previews unsaved draft settings', async () => {
    const d = await (await post({ pin: '781001', settings: { ...EDD_DEFAULTS, remoteDays: 20 } })).json()
    expect(d.zone).toBe('remote')
    expect(d.state).toBe('Assam')
    expect(d.totalDays).toBe(22)
  })
  it('previews from a newly picked warehouse origin', async () => {
    const d = await (await post({ pin: '411045', defaultWarehouse: 'Pune WH' })).json()
    expect(d.originPin).toBe('411001')
    expect(d.zone).toBe('same_city')
  })
})
