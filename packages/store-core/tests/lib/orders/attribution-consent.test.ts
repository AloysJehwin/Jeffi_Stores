// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { adsConsentFromRequest, attachOrderAttribution } from '@/lib/orders/attribution'

const req = (cookie?: string) => new Request('https://acme.jeffistores.in/api/orders/create', cookie ? { headers: { cookie } } : {})

describe('adsConsentFromRequest', () => {
  it("reads the ads flag of the jeffi_consent cookie", () => {
    expect(adsConsentFromRequest(req('jeffi_consent=v1.1.1'))).toBe(true)
    expect(adsConsentFromRequest(req('a=1; jeffi_consent=v1.1.0; b=2'))).toBe(false)
    expect(adsConsentFromRequest(req('jeffi_consent=v1%2E0%2E1'))).toBe(true)
  })

  it('is null without a valid choice', () => {
    expect(adsConsentFromRequest(req())).toBeNull()
    expect(adsConsentFromRequest(req('jeffi_attr=x'))).toBeNull()
    expect(adsConsentFromRequest(req('jeffi_consent=v2.1.1'))).toBeNull()
    expect(adsConsentFromRequest(req('jeffi_consent=garbage'))).toBeNull()
  })
})

describe('attachOrderAttribution', () => {
  const attribution = { gclid: 'Cj0KCQ', landing_path: '/p', ts: Date.parse('2026-10-15T08:00:00Z') }

  it('stamps consent next to the click attribution', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) }
    await attachOrderAttribution(client as any, 'o1', attribution, true)
    const [sql, params] = (client.query.mock.calls as any[])[0]
    expect(sql).toContain('ads_consent = $12')
    expect(params[1]).toBe('Cj0KCQ')
    expect(params[10]).toBe('2026-10-15T08:00:00.000Z')
    expect(params[11]).toBe(true)
  })

  it('stamps consent alone, and does nothing with neither', async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })) }
    await attachOrderAttribution(client as any, 'o1', null, false)
    expect(client.query).toHaveBeenCalledWith('UPDATE orders SET ads_consent = $2 WHERE id = $1', ['o1', false])
    client.query.mockClear()
    await attachOrderAttribution(client as any, 'o1', null)
    expect(client.query).not.toHaveBeenCalled()
  })
})
