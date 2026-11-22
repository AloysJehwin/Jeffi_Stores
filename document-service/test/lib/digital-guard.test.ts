import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@jeffi/tenancy', () => ({
  queryOne: vi.fn(),
  queryMany: vi.fn(),
}))

import { isDigitalProduct, canHoldVaultFiles, findDigitalProductIds } from '../../src/lib/digital-guard.js'
import { queryOne, queryMany } from '@jeffi/tenancy'

beforeEach(() => vi.resetAllMocks())

describe('isDigitalProduct', () => {
  it('true when row is_digital', async () => {
    vi.mocked(queryOne).mockResolvedValue({ is_digital: true } as any)
    expect(await isDigitalProduct('p1')).toBe(true)
  })
  it('false when row is_digital false', async () => {
    vi.mocked(queryOne).mockResolvedValue({ is_digital: false } as any)
    expect(await isDigitalProduct('p1')).toBe(false)
  })
  it('false when row null', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    expect(await isDigitalProduct('p1')).toBe(false)
  })
})

describe('canHoldVaultFiles', () => {
  it('true when ok', async () => {
    vi.mocked(queryOne).mockResolvedValue({ ok: true } as any)
    expect(await canHoldVaultFiles('p1')).toBe(true)
  })
  it('false when not ok', async () => {
    vi.mocked(queryOne).mockResolvedValue({ ok: false } as any)
    expect(await canHoldVaultFiles('p1')).toBe(false)
  })
  it('false when null row', async () => {
    vi.mocked(queryOne).mockResolvedValue(null as any)
    expect(await canHoldVaultFiles('p1')).toBe(false)
  })
})

describe('findDigitalProductIds', () => {
  it('empty input returns [] with no query', async () => {
    expect(await findDigitalProductIds([])).toEqual([])
    expect(queryMany).not.toHaveBeenCalled()
  })
  it('all-falsy input returns [] with no query', async () => {
    expect(await findDigitalProductIds(['', null as any, undefined as any])).toEqual([])
    expect(queryMany).not.toHaveBeenCalled()
  })
  it('dedupes ids and maps result rows', async () => {
    vi.mocked(queryMany).mockResolvedValue([{ id: 'a' }, { id: 'c' }] as any)
    const out = await findDigitalProductIds(['a', 'a', 'b', 'c'])
    expect(out).toEqual(['a', 'c'])
    const args = vi.mocked(queryMany).mock.calls[0][1] as any[]
    expect(args[0]).toEqual(['a', 'b', 'c'])
  })
})
