import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  trackViewedProduct,
  trackSearch,
  getViewedProducts,
  getSearches,
  clearSessionSignals,
} from '@/lib/on-device/session-signals'

const VIEWED_KEY = 'jeffi_od_viewed'
const SEARCH_KEY = 'jeffi_od_searches'

describe('session-signals', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  describe('trackViewedProduct / getViewedProducts', () => {
    it('starts empty', () => {
      expect(getViewedProducts()).toEqual([])
    })

    it('records a viewed product name', () => {
      trackViewedProduct('Hex Bolt M8')
      expect(getViewedProducts()).toEqual(['Hex Bolt M8'])
    })

    it('pushes newest to the front', () => {
      trackViewedProduct('A')
      trackViewedProduct('B')
      trackViewedProduct('C')
      expect(getViewedProducts()).toEqual(['C', 'B', 'A'])
    })

    it('dedupes case-insensitively and moves the entry to the front', () => {
      trackViewedProduct('Washer')
      trackViewedProduct('Bolt')
      trackViewedProduct('washer')
      expect(getViewedProducts()).toEqual(['washer', 'Bolt'])
    })

    it('trims whitespace from the stored value', () => {
      trackViewedProduct('   Nut   ')
      expect(getViewedProducts()).toEqual(['Nut'])
    })

    it('ignores null', () => {
      trackViewedProduct(null)
      expect(getViewedProducts()).toEqual([])
    })

    it('ignores undefined', () => {
      trackViewedProduct(undefined)
      expect(getViewedProducts()).toEqual([])
    })

    it('ignores empty string', () => {
      trackViewedProduct('')
      expect(getViewedProducts()).toEqual([])
    })

    it('ignores a whitespace-only string', () => {
      trackViewedProduct('    ')
      expect(getViewedProducts()).toEqual([])
    })

    it('caps the stored list at 20 entries', () => {
      for (let i = 0; i < 25; i++) trackViewedProduct(`item-${i}`)
      const list = getViewedProducts()
      expect(list.length).toBe(20)
      // newest first, oldest dropped
      expect(list[0]).toBe('item-24')
      expect(list).not.toContain('item-4')
    })
  })

  describe('trackSearch / getSearches', () => {
    it('starts empty', () => {
      expect(getSearches()).toEqual([])
    })

    it('records a search term', () => {
      trackSearch('stainless bolt')
      expect(getSearches()).toEqual(['stainless bolt'])
    })

    it('dedupes case-insensitively', () => {
      trackSearch('Bolt')
      trackSearch('bolt')
      expect(getSearches()).toEqual(['bolt'])
    })

    it('ignores null / empty term', () => {
      trackSearch(null)
      trackSearch('  ')
      expect(getSearches()).toEqual([])
    })

    it('keeps viewed and search buckets independent', () => {
      trackViewedProduct('P1')
      trackSearch('S1')
      expect(getViewedProducts()).toEqual(['P1'])
      expect(getSearches()).toEqual(['S1'])
    })
  })

  describe('clearSessionSignals', () => {
    it('removes both buckets', () => {
      trackViewedProduct('P1')
      trackSearch('S1')
      clearSessionSignals()
      expect(getViewedProducts()).toEqual([])
      expect(getSearches()).toEqual([])
      expect(sessionStorage.getItem(VIEWED_KEY)).toBeNull()
      expect(sessionStorage.getItem(SEARCH_KEY)).toBeNull()
    })

    it('swallows errors thrown by sessionStorage.removeItem', () => {
      const spy = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
        throw new Error('boom')
      })
      expect(() => clearSessionSignals()).not.toThrow()
      spy.mockRestore()
    })
  })

  describe('read() error / guard branches', () => {
    it('returns [] when stored JSON is corrupt (parse throws)', () => {
      sessionStorage.setItem(VIEWED_KEY, '{not valid json')
      expect(getViewedProducts()).toEqual([])
    })

    it('returns [] when getItem throws', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('denied')
      })
      expect(getSearches()).toEqual([])
    })
  })

  describe('write() error branch', () => {
    it('swallows quota / private-mode errors from setItem', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError')
      })
      expect(() => trackViewedProduct('X')).not.toThrow()
    })
  })

  describe('sessionStorage undefined guard', () => {
    it('read returns [] and write is a no-op when sessionStorage is undefined', () => {
      const original = globalThis.sessionStorage
      // remove the global so `typeof sessionStorage === "undefined"` guard hits
      Object.defineProperty(globalThis, 'sessionStorage', {
        value: undefined,
        configurable: true,
      })
      try {
        expect(() => trackViewedProduct('Y')).not.toThrow()
        expect(getViewedProducts()).toEqual([])
      } finally {
        Object.defineProperty(globalThis, 'sessionStorage', {
          value: original,
          configurable: true,
        })
      }
    })
  })
})
