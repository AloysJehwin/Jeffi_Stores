import { describe, it, expect } from 'vitest'

import {
  policies,
  POLICY_VERSION,
  CONSENT_POLICIES,
  getPolicyBySlug,
} from '@/lib/legals/policies'

describe('policies constants', () => {
  it('POLICY_VERSION is a date-like string', () => {
    expect(POLICY_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('CONSENT_POLICIES contains privacy-policy and terms-and-conditions', () => {
    expect(CONSENT_POLICIES).toContain('privacy-policy')
    expect(CONSENT_POLICIES).toContain('terms-and-conditions')
  })

  it('policies array is non-empty', () => {
    expect(policies.length).toBeGreaterThan(0)
  })

  it('every policy has slug, title, description, lastUpdated, sections', () => {
    for (const p of policies) {
      expect(typeof p.slug).toBe('string')
      expect(typeof p.title).toBe('string')
      expect(typeof p.description).toBe('string')
      expect(typeof p.lastUpdated).toBe('string')
      expect(Array.isArray(p.sections)).toBe(true)
      expect(p.sections.length).toBeGreaterThan(0)
    }
  })

  it('every section has heading and body', () => {
    for (const p of policies) {
      for (const s of p.sections) {
        expect(typeof s.heading).toBe('string')
        expect(s.body !== undefined).toBe(true)
      }
    }
  })

  it('section body can be string or string array', () => {
    let foundString = false
    let foundArray = false
    for (const p of policies) {
      for (const s of p.sections) {
        if (typeof s.body === 'string') foundString = true
        if (Array.isArray(s.body)) foundArray = true
      }
    }
    expect(foundString || foundArray).toBe(true)
  })
})

describe('getPolicyBySlug', () => {
  it('returns the privacy-policy when queried', () => {
    const p = getPolicyBySlug('privacy-policy')
    expect(p).toBeDefined()
    expect(p!.slug).toBe('privacy-policy')
    expect(p!.title).toMatch(/Privacy/i)
  })

  it('returns the terms-and-conditions policy', () => {
    const p = getPolicyBySlug('terms-and-conditions')
    expect(p).toBeDefined()
    expect(p!.slug).toBe('terms-and-conditions')
  })

  it('returns undefined for an unknown slug', () => {
    expect(getPolicyBySlug('does-not-exist')).toBeUndefined()
  })

  it('returns undefined for an empty string slug', () => {
    expect(getPolicyBySlug('')).toBeUndefined()
  })

  it('all slugs defined in policies are retrievable', () => {
    for (const p of policies) {
      const found = getPolicyBySlug(p.slug)
      expect(found).toBeDefined()
      expect(found!.slug).toBe(p.slug)
    }
  })

  it('returned policy object is the same reference as in policies array', () => {
    const slug = policies[0].slug
    const found = getPolicyBySlug(slug)
    expect(found).toBe(policies[0])
  })
})
