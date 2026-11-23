import { describe, it, expect } from 'vitest'
import { moqError } from '@/lib/catalog/moq'

describe('moqError', () => {
  it('null when moq <= 1 (no minimum)', () => {
    expect(moqError(1, 5)).toBeNull()
    expect(moqError(0, 5)).toBeNull()
    expect(moqError(null, 5)).toBeNull()
    expect(moqError('x', 5)).toBeNull()
  })
  it('null when qty is non-positive', () => {
    expect(moqError(10, 0)).toBeNull()
    expect(moqError(10, -1)).toBeNull()
  })
  it('null for non-count (measured) units', () => {
    expect(moqError(10, 2, { dimension: 'weight' })).toBeNull()
    expect(moqError(10, 2, { dimension: 'length', factor: 1 })).toBeNull()
  })
  it('null when qty*factor meets the minimum', () => {
    expect(moqError(10, 10)).toBeNull() // factor defaults to 1
    expect(moqError(12, 1, { factor: 12, dimension: 'count' })).toBeNull()
  })
  it('message (pieces only) when factor is 1', () => {
    expect(moqError(10, 5)).toBe('Minimum order for business buyers is 10 pieces.')
  })
  it('message with pack count when factor > 1', () => {
    // moq 10, factor 3 → need ceil(10/3)=4 packs
    expect(moqError(10, 1, { factor: 3, dimension: 'count' })).toBe(
      'Minimum order for business buyers is 10 pieces (4 packs).'
    )
  })
  it('treats non-positive factor as 1', () => {
    expect(moqError(10, 5, { factor: 0, dimension: 'count' })).toBe('Minimum order for business buyers is 10 pieces.')
  })
})
