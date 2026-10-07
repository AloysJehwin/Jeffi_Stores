import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/(admin)/admin/certificates/download/route'

// #487: admin certificates are NEVER downloadable from an admin panel — the sole path is the
// certificate portal. This route is a permanent 410 tombstone: no auth, no token lookup, no .p12,
// regardless of input. These tests lock that in so it can't regress to serving certs.

describe('GET /api/admin/certificates/download — portal-only tombstone', () => {
  it('returns 410 Gone with no certificate payload', async () => {
    const res = await GET()
    expect(res.status).toBe(410)
    const body = await res.json()
    expect(body.error).toMatch(/no longer downloadable/i)
    expect(body.portalUrl).toContain('certificate.')
    // Never leaks a certificate blob/password/token.
    expect(JSON.stringify(body)).not.toMatch(/p12|password|download_token|p12Base64/i)
  })

  it('is 410 even on repeated calls (no state, no token path)', async () => {
    expect((await GET()).status).toBe(410)
    expect((await GET()).status).toBe(410)
  })
})
