import { describe, it, expect } from 'vitest'
import { NextRequest } from 'next/server'

import { GET } from '@/app/api/(public)/products/edd/route'

function makeReq(params: Record<string, string> = {}) {
  const url = new URL('http://localhost/api/products/edd')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url.toString())
}

describe('GET /api/products/edd', () => {
  it('returns an edd date string', async () => {
    const res = await GET(makeReq({ pin: '600001' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.edd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('uses 7-day TAT for invalid/missing pin', async () => {
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.edd).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('uses metro TAT for Chennai pin (600xxx)', async () => {
    const res = await GET(makeReq({ pin: '600001' }))
    const body = await res.json()
    // TAT = 2 (handling) + 10 (metro) = 12 days from today
    const edd = new Date(body.edd)
    const today = new Date()
    const diff = Math.round((edd.getTime() - today.getTime()) / 86400000)
    expect(diff).toBeGreaterThanOrEqual(11)
    expect(diff).toBeLessThanOrEqual(13)
  })

  it('uses 7-day TAT for pin starting with 49', async () => {
    const res = await GET(makeReq({ pin: '490001' }))
    const body = await res.json()
    const edd = new Date(body.edd)
    const today = new Date()
    const diff = Math.round((edd.getTime() - today.getTime()) / 86400000)
    // TAT = 2 (handling) + 7 = 9
    expect(diff).toBeGreaterThanOrEqual(8)
    expect(diff).toBeLessThanOrEqual(10)
  })

  it('respects extraDays param', async () => {
    const resNormal = await GET(makeReq({ pin: '600001' }))
    const resExtra = await GET(makeReq({ pin: '600001', extraDays: '3' }))
    const normal = new Date((await resNormal.json()).edd)
    const extra = new Date((await resExtra.json()).edd)
    expect(extra.getTime() - normal.getTime()).toBe(3 * 86400000)
  })

  it('uses minimum handling of 2 days even if handlingDays=0', async () => {
    const resMin = await GET(makeReq({ pin: '600001', handlingDays: '0' }))
    const resTwo = await GET(makeReq({ pin: '600001', handlingDays: '2' }))
    expect((await resMin.json()).edd).toBe((await resTwo.json()).edd)
  })
})
