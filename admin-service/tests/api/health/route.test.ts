import { describe, it, expect, afterEach } from 'vitest'
import { GET, dynamic } from '@admin/app/api/health/route'

describe('GET /api/health', () => {
  const old = { v: process.env.NEXT_PUBLIC_APP_VERSION, c: process.env.NEXT_PUBLIC_GIT_SHA }
  afterEach(() => {
    if (old.v === undefined) delete process.env.NEXT_PUBLIC_APP_VERSION
    else process.env.NEXT_PUBLIC_APP_VERSION = old.v
    if (old.c === undefined) delete process.env.NEXT_PUBLIC_GIT_SHA
    else process.env.NEXT_PUBLIC_GIT_SHA = old.c
  })

  it('is dynamic so it is never cached', () => {
    expect(dynamic).toBe('force-dynamic')
  })

  it('answers 200 with the baked-in version and commit', async () => {
    process.env.NEXT_PUBLIC_APP_VERSION = '1.2.3'
    process.env.NEXT_PUBLIC_GIT_SHA = 'abc123'
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', version: '1.2.3', commit: 'abc123' })
  })

  it('reports unknown when the build info is absent', async () => {
    delete process.env.NEXT_PUBLIC_APP_VERSION
    delete process.env.NEXT_PUBLIC_GIT_SHA
    expect(await (await GET()).json()).toEqual({ status: 'ok', version: 'unknown', commit: 'unknown' })
  })
})
