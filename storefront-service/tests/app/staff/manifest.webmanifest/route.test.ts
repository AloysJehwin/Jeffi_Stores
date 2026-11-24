import { describe, it, expect } from 'vitest'
import { GET } from '@storefront/app/(portal)/staff/manifest.webmanifest/route'

describe('GET /staff/manifest.webmanifest', () => {
  it('describes the installable staff-notes app', async () => {
    const res = GET()
    expect(res.headers.get('content-type')).toBe('application/manifest+json')
    const m = await res.json()
    expect(m).toMatchObject({ name: 'Staff Notes', start_url: '/staff/notes', scope: '/staff/', display: 'standalone' })
    expect(m.icons[0].src).toBe('/icon.png')
  })
})
