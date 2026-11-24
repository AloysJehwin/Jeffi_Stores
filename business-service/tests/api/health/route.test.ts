import { describe, it, expect } from 'vitest'
import { GET } from '@business/app/api/health/route'

describe('GET /api/health (business)', () => {
  it('answers ok without touching dependencies', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('ok')
  })
})
