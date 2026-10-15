import { describe, it, expect } from 'vitest'
import { groupSyncErrors, countSyncErrorItems } from '@/lib/merchant/sync-errors'

describe('merchant/sync-errors', () => {
  const errors = [
    { sku: 'batch-0', error: 'HTTP 410: gone', items: 100 },
    { sku: 'batch-100', error: 'HTTP 410: gone', items: 40 },
    { sku: 'A', error: 'Missing product image' },
    { sku: 'B', error: 'Missing product image' },
    { sku: 'C', error: 'Invalid URL https://x/a.png' },
    { sku: 'D', error: 'Invalid URL https://x/b.png' },
  ]

  it('groups by reason, counts affected items and sorts by count', () => {
    const groups = groupSyncErrors(errors)
    expect(groups[0]).toEqual({ reason: 'HTTP 410: gone', count: 140, skus: ['batch-0', 'batch-100'] })
    expect(groups.find(g => g.reason === 'Missing product image')).toEqual({
      reason: 'Missing product image',
      count: 2,
      skus: ['A', 'B'],
    })
  })

  it('collapses URLs so per-item links land in one group', () => {
    expect(groupSyncErrors(errors).find(g => g.reason === 'Invalid URL <url>')?.count).toBe(2)
  })

  it('caps the SKU sample per group', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ sku: `S${i}`, error: 'x' }))
    expect(groupSyncErrors(many, 3)[0]).toEqual({ reason: 'x', count: 10, skus: ['S0', 'S1', 'S2'] })
  })

  it('counts items, treating plain errors as one', () => {
    expect(countSyncErrorItems(errors)).toBe(144)
    expect(countSyncErrorItems(null)).toBe(0)
  })
})
