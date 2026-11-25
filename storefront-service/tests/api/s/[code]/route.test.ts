import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const poolQuery = vi.hoisted(() => vi.fn())
const verifyLink = vi.hoisted(() => vi.fn())

vi.mock('@/lib/tenant-registry/shared', () => ({ controlPlanePool: () => ({ query: poolQuery }) }))
vi.mock('@jeffi/tenancy', () => ({ verifyLink }))

import { GET } from '@storefront/app/api/(public)/s/[code]/route'

const call = (code: string) =>
  GET(new NextRequest(`http://localhost/api/s/${code}`), { params: Promise.resolve({ code }) })

describe('GET /api/s/[code]', () => {
  beforeEach(() => {
    verifyLink.mockReturnValue(null)
    poolQuery.mockResolvedValue({ rows: [] })
  })

  it('redirects a signed link to its destination and counts the click', async () => {
    verifyLink.mockReturnValue({ id: 'link-1', destination: 'https://shop.test/p/1' })
    const res = await call('signed.code')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://shop.test/p/1')
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('click_count=click_count+1'), ['link-1'])
  })

  it('redirects a stored short link and counts the click', async () => {
    poolQuery.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT') ? { rows: [{ destination_url: 'https://shop.test/sale' }] } : { rows: [] }
    )
    const res = await call('abc123')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://shop.test/sale')
    expect(poolQuery).toHaveBeenCalledWith(expect.stringContaining('UPDATE short_link'), ['abc123'])
  })

  it('404s an unknown or expired code', async () => {
    const res = await call('missing')
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('not found')
  })

  it('404s a stored destination that is not http(s), never redirecting to it', async () => {
    poolQuery.mockResolvedValue({ rows: [{ destination_url: 'javascript:alert(1)' }] })
    const res = await call('evil')
    expect(res.status).toBe(404)
    expect(res.headers.get('location')).toBeNull()
  })

  it('404s when the lookup query fails', async () => {
    poolQuery.mockRejectedValue(new Error('db'))
    expect((await call('x')).status).toBe(404)
  })
})
