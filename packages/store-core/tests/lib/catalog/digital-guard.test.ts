import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/shared/db', () => ({ queryOne: vi.fn(), queryMany: vi.fn() }))

import { isDigitalProduct, canHoldVaultFiles, findDigitalProductIds } from '@/lib/catalog/digital-guard'
import { queryOne, queryMany } from '@/lib/shared/db'

const mockQueryOne = vi.mocked(queryOne)
const mockQueryMany = vi.mocked(queryMany)

beforeEach(() => {
  mockQueryOne.mockReset()
  mockQueryMany.mockReset()
})

describe('isDigitalProduct', () => {
  it('true when the row says so', async () => {
    mockQueryOne.mockResolvedValue({ is_digital: true } as any)
    expect(await isDigitalProduct('p1')).toBe(true)
    const [sql, params] = mockQueryOne.mock.calls[0]
    expect(sql).toContain('SELECT is_digital FROM products WHERE id = $1')
    expect(params).toEqual(['p1'])
  })
  it('false when flag false or no row', async () => {
    mockQueryOne.mockResolvedValue({ is_digital: false } as any)
    expect(await isDigitalProduct('p1')).toBe(false)
    mockQueryOne.mockResolvedValue(null as any)
    expect(await isDigitalProduct('p1')).toBe(false)
  })
})

describe('canHoldVaultFiles', () => {
  it('true when the ok flag is set', async () => {
    mockQueryOne.mockResolvedValue({ ok: true } as any)
    expect(await canHoldVaultFiles('p1')).toBe(true)
    expect(mockQueryOne.mock.calls[0][0]).toContain('product_drafts')
  })
  it('false otherwise', async () => {
    mockQueryOne.mockResolvedValue({ ok: false } as any)
    expect(await canHoldVaultFiles('p1')).toBe(false)
    mockQueryOne.mockResolvedValue(null as any)
    expect(await canHoldVaultFiles('p1')).toBe(false)
  })
})

describe('findDigitalProductIds', () => {
  it('empty input → no query, empty result', async () => {
    expect(await findDigitalProductIds([])).toEqual([])
    expect(await findDigitalProductIds(['', null as any])).toEqual([])
    expect(mockQueryMany).not.toHaveBeenCalled()
  })
  it('dedupes ids and returns matching digital ids', async () => {
    mockQueryMany.mockResolvedValue([{ id: 'a' }, { id: 'c' }] as any)
    expect(await findDigitalProductIds(['a', 'a', 'b', 'c'])).toEqual(['a', 'c'])
    const [sql, params] = mockQueryMany.mock.calls[0]
    expect(sql).toContain('is_digital = true')
    expect(params).toEqual([['a', 'b', 'c']])
  })
})
