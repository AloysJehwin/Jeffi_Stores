import { describe, it, expect } from 'vitest'
import {
  SITE_AUDIENCES,
  SITE_SURFACES,
  PAGE_KEYS,
  isPageKey,
  CHROME_PAGES,
  isChromePage,
  surfaceAllows,
  pageRefKey,
  parsePageRefKey,
  type PageRef,
} from '@jeffi/site-blocks'

describe('constants', () => {
  it('lists the two audiences and three surfaces', () => {
    expect(SITE_AUDIENCES).toEqual(['store', 'business'])
    expect(SITE_SURFACES).toEqual(['web', 'web_mobile', 'app'])
  })
  it('includes the chrome and special pages in PAGE_KEYS', () => {
    for (const k of ['home', 'header', 'footer', 'announcement', 'card', 'showcase']) {
      expect(PAGE_KEYS as readonly string[]).toContain(k)
    }
  })
})

describe('isPageKey', () => {
  it('accepts known keys', () => {
    expect(isPageKey('home')).toBe(true)
    expect(isPageKey('showcase')).toBe(true)
  })
  it('rejects unknown strings and non-strings', () => {
    expect(isPageKey('nope')).toBe(false)
    expect(isPageKey(42)).toBe(false)
    expect(isPageKey(null)).toBe(false)
    expect(isPageKey(undefined)).toBe(false)
  })
})

describe('isChromePage', () => {
  it('is true only for header/footer/announcement', () => {
    expect(CHROME_PAGES).toEqual(['header', 'footer', 'announcement'])
    expect(isChromePage('header')).toBe(true)
    expect(isChromePage('footer')).toBe(true)
    expect(isChromePage('announcement')).toBe(true)
    expect(isChromePage('home')).toBe(false)
  })
})

describe('surfaceAllows', () => {
  it('allows every page on non-app surfaces', () => {
    expect(surfaceAllows('web', 'legal')).toBe(true)
    expect(surfaceAllows('web_mobile', 'checkout')).toBe(true)
  })
  it('on app allows only home/products/category/brand', () => {
    expect(surfaceAllows('app', 'home')).toBe(true)
    expect(surfaceAllows('app', 'products')).toBe(true)
    expect(surfaceAllows('app', 'category')).toBe(true)
    expect(surfaceAllows('app', 'brand')).toBe(true)
    expect(surfaceAllows('app', 'checkout')).toBe(false)
    expect(surfaceAllows('app', 'legal')).toBe(false)
  })
})

describe('pageRefKey', () => {
  it('joins the four parts with an empty slug default', () => {
    const r: PageRef = { audience: 'store', surface: 'web', page: 'home' }
    expect(pageRefKey(r)).toBe('store:web:home:')
  })
  it('includes the slug for a custom page', () => {
    const r: PageRef = { audience: 'business', surface: 'app', page: 'custom', slug: 'faq' }
    expect(pageRefKey(r)).toBe('business:app:custom:faq')
  })
})

describe('parsePageRefKey', () => {
  it('round-trips a key without a slug', () => {
    const r = parsePageRefKey('store:web:home:')
    expect(r).toEqual({ audience: 'store', surface: 'web', page: 'home', slug: '' })
  })
  it('round-trips a key with a slug', () => {
    const r = parsePageRefKey('business:app:custom:faq')
    expect(r).toEqual({ audience: 'business', surface: 'app', page: 'custom', slug: 'faq' })
  })
  it('defaults the slug to empty when omitted entirely', () => {
    const r = parsePageRefKey('store:web:home')
    expect(r).toEqual({ audience: 'store', surface: 'web', page: 'home', slug: '' })
  })
  it('returns null on a bad audience', () => {
    expect(parsePageRefKey('nobody:web:home:')).toBeNull()
  })
  it('returns null on a bad surface', () => {
    expect(parsePageRefKey('store:desktop:home:')).toBeNull()
  })
  it('returns null on a bad page', () => {
    expect(parsePageRefKey('store:web:nope:')).toBeNull()
  })
})
