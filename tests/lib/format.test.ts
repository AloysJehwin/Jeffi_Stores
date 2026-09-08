import { describe, it, expect } from 'vitest'
import { humanizeLabel } from '@/lib/format'

describe('humanizeLabel', () => {
  it('title-cases an underscore key', () => {
    expect(humanizeLabel('stainless_steel_tarnish_test_life')).toBe('Stainless Steel Tarnish Test Life')
  })

  it('preserves an acronym token', () => {
    expect(humanizeLabel('SST_life_for_red_rust')).toBe('SST Life For Red Rust')
  })

  it('capitalizes an already-clean single word', () => {
    expect(humanizeLabel('standard')).toBe('Standard')
  })

  it('leaves numeric/unit tokens unchanged', () => {
    expect(humanizeLabel('304L')).toBe('304L')
    expect(humanizeLabel('grade_304L')).toBe('Grade 304L')
    expect(humanizeLabel('304')).toBe('304')
  })

  it('is safe on empty input', () => {
    expect(humanizeLabel('')).toBe('')
  })

  it('collapses repeated separators', () => {
    expect(humanizeLabel('a__b  c')).toBe('A B C')
  })
})
