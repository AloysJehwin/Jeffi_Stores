import { describe, it, expect, afterEach } from 'vitest'
import { GET } from '@storefront/app/api/health/route'

describe('GET /api/health', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_APP_VERSION
    delete process.env.NEXT_PUBLIC_GIT_SHA
  })

  it('answers ok without touching dependencies, reporting unknown build info by default', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', version: 'unknown', commit: 'unknown' })
  })

  it('reports the baked-in version and commit', async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '1.2.3'
    process.env.NEXT_PUBLIC_GIT_SHA = 'abc123'
    expect(await (await GET()).json()).toEqual({ status: 'ok', version: '1.2.3', commit: 'abc123' })
  })
})
