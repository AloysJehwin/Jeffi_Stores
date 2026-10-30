import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/jwt', () => ({ authenticateAdmin: vi.fn() }))
vi.mock('@/lib/auth/scopes', () => ({ hasScope: vi.fn() }))
vi.mock('@/lib/shared/db', () => ({ query: vi.fn() }))
vi.mock('@/lib/shipping/delivery-settings', () => ({ invalidateDeliverySettingsCache: vi.fn() }))
vi.mock('@/lib/catalog/site-controls', () => ({ invalidateSiteControlsCache: vi.fn() }))
vi.mock('@/lib/loyalty/settings', () => ({ getLoyaltySettings: vi.fn() }))
vi.mock('@/lib/loyalty/reconcile', () => ({ reconcileLoyaltyUntilDone: vi.fn() }))

import { PATCH } from '@controller/app/api/(admin)/admin/settings/route'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { query } from '@/lib/shared/db'
import { invalidateSiteControlsCache } from '@/lib/catalog/site-controls'

const mockQuery = vi.mocked(query)

function patch(body: object) {
  return PATCH(
    new NextRequest('http://localhost/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  )
}

const upserted = () => mockQuery.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO site_settings'))

describe('PATCH /api/admin/settings — Google tag & Ads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(authenticateAdmin).mockResolvedValue({ adminId: 'a1', role: 'admin', scopes: ['settings:write'] } as any)
    vi.mocked(hasScope).mockReturnValue(true)
    mockQuery.mockResolvedValue({ rows: [], rowCount: 1 } as any)
  })

  it('saves a normalised tag id and clears the site-controls cache', async () => {
    const res = await patch({ key: 'google_tag_id', value: ' g-ab12cd34ef ' })
    expect(res.status).toBe(200)
    expect(upserted()[0][1]).toEqual(['google_tag_id', 'G-AB12CD34EF'])
    expect(invalidateSiteControlsCache).toHaveBeenCalled()
  })

  it('rejects a malformed value without writing', async () => {
    const res = await patch({ key: 'google_ads_conversion_id', value: 'G-NOTADS' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/AW-123456789/)
    expect(upserted()).toHaveLength(0)
  })

  it('allows clearing a value', async () => {
    const res = await patch({ key: 'google_ads_conversion_label', value: '' })
    expect(res.status).toBe(200)
    expect(upserted()[0][1]).toEqual(['google_ads_conversion_label', ''])
  })

  it('validates every tag key in a batch before writing any', async () => {
    const res = await patch({
      updates: [
        { key: 'google_ads_conversion_id', value: 'aw-111222333' },
        { key: 'google_ads_conversion_label', value: 'has/slash' },
      ],
    })
    expect(res.status).toBe(400)
    expect(upserted()).toHaveLength(0)

    const ok = await patch({
      updates: [
        { key: 'google_ads_conversion_id', value: 'aw-111222333' },
        { key: 'google_ads_conversion_label', value: 'lbl_12345' },
      ],
    })
    expect(ok.status).toBe(200)
    expect(upserted().map(c => c[1])).toEqual([
      ['google_ads_conversion_id', 'AW-111222333'],
      ['google_ads_conversion_label', 'lbl_12345'],
    ])
  })
})
