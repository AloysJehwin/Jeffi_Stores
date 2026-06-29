import { vi, describe, it, expect } from 'vitest'

// Mock all scenario modules imported by the registry
vi.mock('@/lib/db', () => ({ queryMany: vi.fn(), query: vi.fn() }))
vi.mock('@/lib/automation-emails', () => ({
  APP_URL: 'https://jeffistores.com',
  fetchUserContext: vi.fn(),
  resolveCoupon: vi.fn(),
  sendCampaignEmail: vi.fn(),
  renderItemRows: vi.fn().mockReturnValue(''),
  renderHeroProduct: vi.fn().mockReturnValue(''),
}))

import { SCENARIOS, getScenario, listScenarios } from '@/lib/campaigns/scenarios/_registry'

describe('_registry', () => {
  it('SCENARIOS contains all 9 expected scenario kinds', () => {
    const kinds = Object.keys(SCENARIOS)
    expect(kinds).toContain('abandoned_cart')
    expect(kinds).toContain('abandoned_checkout')
    expect(kinds).toContain('post_purchase')
    expect(kinds).toContain('review_reminder')
    expect(kinds).toContain('review_request')
    expect(kinds).toContain('winback_90')
    expect(kinds).toContain('winback_180')
    expect(kinds).toContain('restock')
    expect(kinds).toContain('price_drop')
    expect(kinds).toHaveLength(9)
  })

  it('each scenario has the required shape', () => {
    for (const [kind, scenario] of Object.entries(SCENARIOS)) {
      expect(scenario.kind).toBe(kind)
      expect(typeof scenario.name).toBe('string')
      expect(typeof scenario.description).toBe('string')
      expect(typeof scenario.trigger).toBe('string')
      expect(typeof scenario.findEligible).toBe('function')
      expect(typeof scenario.send).toBe('function')
    }
  })

  describe('getScenario', () => {
    it('returns the correct scenario module for a known kind', () => {
      const s = getScenario('abandoned_cart')
      expect(s).not.toBeNull()
      expect(s!.kind).toBe('abandoned_cart')
    })

    it('returns null for an unknown kind', () => {
      expect(getScenario('nonexistent_kind')).toBeNull()
    })

    it('returns null for empty string', () => {
      expect(getScenario('')).toBeNull()
    })
  })

  describe('listScenarios', () => {
    it('returns an array of all scenario modules', () => {
      const list = listScenarios()
      expect(Array.isArray(list)).toBe(true)
      expect(list).toHaveLength(9)
    })

    it('each item in list is a valid scenario module', () => {
      for (const s of listScenarios()) {
        expect(typeof s.kind).toBe('string')
        expect(typeof s.findEligible).toBe('function')
        expect(typeof s.send).toBe('function')
      }
    })

    it('all kinds from SCENARIOS are represented in the list', () => {
      const listKinds = listScenarios().map(s => s.kind)
      for (const kind of Object.keys(SCENARIOS)) {
        expect(listKinds).toContain(kind)
      }
    })
  })
})
