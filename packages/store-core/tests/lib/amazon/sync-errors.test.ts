import { describe, it, expect } from 'vitest'
import { amazonErrorReason, groupAmazonSyncErrors } from '@/lib/amazon/sync-errors'

const spApi = (sku: string, body: string, status = 400) =>
  `Amazon PUT /listings/2021-08-01/items/SELLER/${sku} failed (${status}): ${body}`

describe('amazonErrorReason', () => {
  it("reduces an SP-API failure to its status and Amazon's messages", () => {
    const body = JSON.stringify({
      errors: [
        { code: 'InvalidInput', message: 'Brand not approved' },
        { code: 'InvalidInput', message: 'Brand not approved' },
      ],
    })
    expect(amazonErrorReason(spApi('SKU-1', body))).toBe(
      'Amazon rejected the request (400): InvalidInput: Brand not approved'
    )
  })

  it('keeps a non-JSON body', () => {
    expect(amazonErrorReason(spApi('X', 'Service Unavailable', 503))).toBe(
      'Amazon rejected the request (503): Service Unavailable'
    )
  })

  it('leaves other messages alone', () => {
    expect(amazonErrorReason('mapping failed')).toBe('mapping failed')
    expect(amazonErrorReason('')).toBe('Unknown error')
  })
})

describe('groupAmazonSyncErrors', () => {
  it('groups raw SP-API errors for different SKUs under one reason with counts', () => {
    const body = '{"errors":[{"code":"E1","message":"Missing GTIN"}]}'
    const groups = groupAmazonSyncErrors([
      { sku: 'A', error: spApi('A', body) },
      { sku: 'B', error: spApi('B', body) },
      { sku: 'C', error: 'mapping failed' },
    ])
    expect(groups).toEqual([
      { reason: 'Amazon rejected the request (400): E1: Missing GTIN', count: 2, skus: ['A', 'B'] },
      { reason: 'mapping failed', count: 1, skus: ['C'] },
    ])
  })

  it('handles no errors', () => {
    expect(groupAmazonSyncErrors(null)).toEqual([])
  })
})
