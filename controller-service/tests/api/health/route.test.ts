import { describe, it, expect, afterEach, vi } from 'vitest'
import { GET } from '@controller/app/api/health/route'

afterEach(() => vi.unstubAllEnvs())

describe('GET /api/health', () => {
  it('answers 200 with the baked-in version', async () => {
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '1.2.3')
    vi.stubEnv('NEXT_PUBLIC_GIT_SHA', 'abc123')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', version: '1.2.3', commit: 'abc123' })
  })

  it('falls back to unknown when nothing was baked in', async () => {
    delete process.env.NEXT_PUBLIC_APP_VERSION
    delete process.env.NEXT_PUBLIC_GIT_SHA
    expect(await (await GET()).json()).toMatchObject({ version: 'unknown', commit: 'unknown' })
  })
})
