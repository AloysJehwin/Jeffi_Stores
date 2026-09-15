import { describe, it, expect } from 'vitest'
import { GET } from '@/app/api/health/route'

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  // The probe reports the build it is serving so a deployed box can be identified without
  // shell access. Unset in dev/test, hence the 'unknown' fallback.
  it('reports the running version and commit', async () => {
    const body = await (await GET()).json()
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('commit')
  })
})
