import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { checkPincodeServiceability } from '@/lib/delhivery'

const OK = (postal: Record<string, unknown>) => ({
  ok: true, status: 200, json: async () => ({ delivery_codes: [{ postal_code: postal }] }),
})

describe('a pickup pincode is checked while the owner is still on the form', () => {
  beforeEach(() => { process.env.DELHIVERY_API_KEY = 'test-token' })
  afterEach(() => { vi.unstubAllGlobals() })

  it('reports pickup availability for a serviceable pin', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      OK({ pin: 560048, pickup: 'Y', cod: 'Y', pre_paid: 'Y', district: 'Bengaluru', state_code: 'KA' })))
    const r = await checkPincodeServiceability('560048')
    expect(r).toMatchObject({ serviceable: true, pickup: true, cod: true, district: 'Bengaluru' })
  })

  it('flags a pin Delhivery delivers to but cannot collect from', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      OK({ pin: 999999, pickup: 'N', cod: 'Y', pre_paid: 'Y' })))
    const r = await checkPincodeServiceability('999999')
    expect(r.serviceable).toBe(true)
    expect(r.pickup).toBe(false)
  })

  it('treats an empty result as not serviceable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ delivery_codes: [] }) }))
    expect((await checkPincodeServiceability('110001')).serviceable).toBe(false)
  })

  it('rejects a malformed pincode without calling Delhivery', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    const r = await checkPincodeServiceability('12ab')
    expect(r.error).toMatch(/six digits/)
    expect(f).not.toHaveBeenCalled()
  })

  it('reports rather than throws when Delhivery is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')))
    const r = await checkPincodeServiceability('560048')
    expect(r.serviceable).toBe(false)
    expect(r.error).toMatch(/reach/)
  })

  it('reports rather than throws on a non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }))
    const r = await checkPincodeServiceability('560048')
    expect(r.error).toContain('503')
  })
})
