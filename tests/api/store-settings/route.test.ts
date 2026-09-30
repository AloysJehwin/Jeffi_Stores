import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/shared/db', () => ({
  queryOne: vi.fn().mockResolvedValue(null),
}))

// ---------------------------------------------------------------------------

import { GET } from '@/app/api/store-settings/route'
import { queryOne } from '@/lib/shared/db'

const mockQueryOne = vi.mocked(queryOne)

describe('GET /api/store-settings', () => {
  beforeEach(() => {
    mockQueryOne.mockResolvedValue(null)
  })

  it('returns 200 with minOrderAmount=0 when setting does not exist', async () => {
    mockQueryOne.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('minOrderAmount', 0)
  })

  it('returns 200 with the stored minOrderAmount value', async () => {
    mockQueryOne.mockResolvedValue({ value: '500' })
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.minOrderAmount).toBe(500)
  })

  it('returns minOrderAmount=0 when stored value is not a valid number', async () => {
    mockQueryOne.mockResolvedValue({ value: 'not-a-number' })
    const res = await GET()
    const body = await res.json()
    expect(body.minOrderAmount).toBe(0)
  })

  it('returns a settings object (has minOrderAmount key)', async () => {
    const res = await GET()
    const body = await res.json()
    expect(body).toHaveProperty('minOrderAmount')
  })
})
