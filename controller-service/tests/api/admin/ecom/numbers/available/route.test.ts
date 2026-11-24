import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const auth = vi.hoisted(() => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/jwt', () => auth)
const provider = vi.hoisted(() => ({ search: vi.fn(), monthlyPriceUsd: vi.fn(), live: true }))
vi.mock('@controller/lib/messaging/number-provider', () => ({ numberProvider: () => provider }))

import { GET } from '@controller/app/api/(admin)/admin/ecom/numbers/available/route'

const call = (qs = '') => GET(new NextRequest(`http://localhost/api/admin/ecom/numbers/available${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-1', role: 'administrator', scopes: [] })
  provider.search.mockResolvedValue([{ number: '+18722704479' }])
  provider.monthlyPriceUsd.mockResolvedValue(1.15)
})

describe('GET /api/admin/ecom/numbers/available', () => {
  it('401s and 403s', async () => {
    auth.authenticateAdmin.mockResolvedValue(null)
    expect((await call()).status).toBe(401)
    auth.authenticateAdmin.mockResolvedValue({ adminId: 'a-2', role: 'super_admin', scopes: [] })
    expect((await call()).status).toBe(403)
    expect(provider.search).not.toHaveBeenCalled()
  })

  it('defaults to US and returns numbers with the monthly price', async () => {
    const res = await call()
    expect(await res.json()).toEqual({ numbers: [{ number: '+18722704479' }], monthlyUsd: 1.15, live: true })
    expect(provider.search).toHaveBeenCalledWith({ country: 'US', areaCode: undefined, limit: 8 })
  })

  it('normalises country and area code', async () => {
    await call('?country=gbr&areaCode=(87)2-27x')
    expect(provider.search).toHaveBeenCalledWith({ country: 'GB', areaCode: '8722', limit: 8 })
    expect(provider.monthlyPriceUsd).toHaveBeenCalledWith('GB')
  })

  it('502s when the provider search fails', async () => {
    provider.search.mockRejectedValue(new Error('twilio down'))
    const res = await call()
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'twilio down' })
  })
})
