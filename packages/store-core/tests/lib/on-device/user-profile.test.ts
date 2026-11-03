import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  readUserProfile,
  updateUserProfile,
  incrementSessionCount,
  type OrderSignal,
} from '@/lib/on-device/user-profile'

const PROFILE_KEY = 'jeffi_od_profile'

describe('on-device/user-profile', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('readUserProfile', () => {
    it('returns a fresh default profile when nothing stored', () => {
      const p = readUserProfile()
      expect(p).toEqual({
        topCategories: [],
        topBrands: [],
        priceRange: null,
        purchaseCount: 0,
        lastPurchaseDate: null,
        preferredBuyMode: null,
        sessionCount: 0,
      })
    })

    it('returns a new top-level object each call', () => {
      const a = readUserProfile()
      const b = readUserProfile()
      expect(a).not.toBe(b)
    })

    it('merges stored partial data over defaults', () => {
      localStorage.setItem(PROFILE_KEY, JSON.stringify({ purchaseCount: 3, topBrands: ['bosch'] }))
      const p = readUserProfile()
      expect(p.purchaseCount).toBe(3)
      expect(p.topBrands).toEqual(['bosch'])
      // untouched keys keep defaults
      expect(p.priceRange).toBeNull()
      expect(p.sessionCount).toBe(0)
    })

    it('returns defaults when stored JSON is malformed (catch path)', () => {
      localStorage.setItem(PROFILE_KEY, '{not-valid-json')
      const p = readUserProfile()
      expect(p.purchaseCount).toBe(0)
      expect(p.topCategories).toEqual([])
    })

    it('returns defaults when localStorage.getItem throws (catch path)', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('boom')
      })
      const p = readUserProfile()
      expect(p.sessionCount).toBe(0)
    })
  })

  describe('updateUserProfile', () => {
    const baseOrder = (o: Partial<OrderSignal> = {}): OrderSignal => ({
      categories: [],
      brands: [],
      total: 0,
      itemCount: 0,
      ...o,
    })

    it('adds categories and brands, increments purchase count, sets date', () => {
      updateUserProfile(baseOrder({ categories: ['Tools', 'Nuts'], brands: ['Bosch'], total: 500 }))
      const p = readUserProfile()
      expect(p.topCategories).toContain('Tools')
      expect(p.topCategories).toContain('Nuts')
      expect(p.topBrands).toContain('Bosch')
      expect(p.purchaseCount).toBe(1)
      expect(p.lastPurchaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('sets initial price range when total > 0 and no prior range', () => {
      updateUserProfile(baseOrder({ total: 250 }))
      const p = readUserProfile()
      expect(p.priceRange).toEqual({ min: 250, max: 250 })
    })

    it('expands existing price range across multiple orders', () => {
      updateUserProfile(baseOrder({ total: 250 }))
      updateUserProfile(baseOrder({ total: 1000 }))
      updateUserProfile(baseOrder({ total: 100 }))
      const p = readUserProfile()
      expect(p.priceRange).toEqual({ min: 100, max: 1000 })
      expect(p.purchaseCount).toBe(3)
    })

    it('does not create a price range when total is 0 (branch)', () => {
      updateUserProfile(baseOrder({ total: 0, categories: ['A'] }))
      const p = readUserProfile()
      expect(p.priceRange).toBeNull()
      expect(p.purchaseCount).toBe(1)
    })

    it('filters out falsy category/brand entries', () => {
      updateUserProfile(
        baseOrder({
          categories: ['Real', '', ''],
          brands: ['B', ''],
        })
      )
      const p = readUserProfile()
      expect(p.topCategories).toEqual(['Real'])
      expect(p.topBrands).toEqual(['B'])
    })

    it('sets preferredBuyMode when buyMode provided (truthy branch)', () => {
      updateUserProfile(baseOrder({ buyMode: 'delivery' }))
      expect(readUserProfile().preferredBuyMode).toBe('delivery')
    })

    it('leaves preferredBuyMode null when buyMode absent/falsy (else branch)', () => {
      updateUserProfile(baseOrder({ buyMode: null }))
      expect(readUserProfile().preferredBuyMode).toBeNull()
      updateUserProfile(baseOrder({}))
      expect(readUserProfile().preferredBuyMode).toBeNull()
    })

    it('ranks frequently-bought categories higher and caps at MAX_CATEGORIES (8)', () => {
      // First order establishes some categories (weighted x2 as existing next time)
      updateUserProfile(baseOrder({ categories: ['Popular'] }))
      // Second order repeats Popular plus 10 new ones -> capped to 8, Popular first
      updateUserProfile(
        baseOrder({
          categories: ['Popular', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'],
        })
      )
      const p = readUserProfile()
      expect(p.topCategories.length).toBe(8)
      expect(p.topCategories[0]).toBe('Popular')
    })

    it('dedupes case-insensitively when merging brands', () => {
      updateUserProfile(baseOrder({ brands: ['Bosch'] }))
      updateUserProfile(baseOrder({ brands: ['bosch', 'Makita'] }))
      const p = readUserProfile()
      // only one bosch entry regardless of case
      const boschCount = p.topBrands.filter(b => b.toLowerCase() === 'bosch').length
      expect(boschCount).toBe(1)
      expect(p.topBrands.map(b => b.toLowerCase())).toContain('makita')
    })

    it('caps brands at MAX_BRANDS (5)', () => {
      updateUserProfile(baseOrder({ brands: ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'] }))
      expect(readUserProfile().topBrands.length).toBe(5)
    })

    it('swallows errors when readUserProfile/write throws (outer catch)', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      // should not throw
      expect(() => updateUserProfile(baseOrder({ total: 10 }))).not.toThrow()
    })
  })

  describe('incrementSessionCount', () => {
    it('increments from 0 to 1', () => {
      incrementSessionCount()
      expect(readUserProfile().sessionCount).toBe(1)
    })

    it('increments cumulatively across calls', () => {
      incrementSessionCount()
      incrementSessionCount()
      incrementSessionCount()
      expect(readUserProfile().sessionCount).toBe(3)
    })

    it('preserves other profile fields while incrementing', () => {
      updateUserProfile({
        categories: ['X'],
        brands: ['Y'],
        total: 99,
        itemCount: 1,
      })
      incrementSessionCount()
      const p = readUserProfile()
      expect(p.sessionCount).toBe(1)
      expect(p.purchaseCount).toBe(1)
      expect(p.topCategories).toContain('X')
    })

    it('swallows errors when write throws (catch path)', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('quota')
      })
      expect(() => incrementSessionCount()).not.toThrow()
    })
  })
})
