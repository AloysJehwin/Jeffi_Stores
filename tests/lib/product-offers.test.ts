import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('./db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))
vi.mock('@/lib/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { listOffersByIds } from '@/lib/product-offers'
import * as db from '@/lib/db'

const mockQueryMany = db.queryMany as ReturnType<typeof vi.fn>

function offer(id: string) {
  return { id, slug: `s-${id}`, title: id } as unknown
}

describe('listOffersByIds', () => {
  beforeEach(() => {
    mockQueryMany.mockReset()
  })

  it('returns [] and does not query for empty input', async () => {
    const result = await listOffersByIds([])
    expect(result).toEqual([])
    expect(mockQueryMany).not.toHaveBeenCalled()
  })

  it('returns offers in the order of the ids array, not the DB order', async () => {
    // DB returns rows in arbitrary order.
    mockQueryMany.mockResolvedValue([offer('b'), offer('a'), offer('c')])
    const result = await listOffersByIds(['a', 'b', 'c'])
    expect(result.map((o: any) => o.id)).toEqual(['a', 'b', 'c'])
  })

  it('drops ids that are not active / not found', async () => {
    // 'missing' has no row (inactive or absent); it must be dropped.
    mockQueryMany.mockResolvedValue([offer('c'), offer('a')])
    const result = await listOffersByIds(['a', 'missing', 'c'])
    expect(result.map((o: any) => o.id)).toEqual(['a', 'c'])
  })

  it('passes the ids array as a single ANY($1) param', async () => {
    mockQueryMany.mockResolvedValue([])
    await listOffersByIds(['x', 'y'])
    const [, params] = mockQueryMany.mock.calls[0]
    expect(params).toEqual([['x', 'y']])
  })
})
