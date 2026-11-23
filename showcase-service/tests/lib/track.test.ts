import { describe, it, expect } from 'vitest'
import { classifyLink } from '@showcase/lib/links'
import { visitorGeo } from '@showcase/lib/geo'
import { visitorKey } from '@showcase/lib/track'

// What the Showcase tracker makes of a tapped link, a visitor's country, and the visitor key.

const SITE = 'site-latte.jeffistores.in'
const headers = (h: Record<string, string> = {}) => new Headers(h)

describe('classifyLink', () => {
  it.each([
    ['tel:+919876543210', { target: 'call', label: 'tel' }],
    ['sms:+919876543210', { target: 'call', label: 'sms' }],
    ['mailto:hi@latte.in', { target: 'email' }],
    ['https://wa.me/919876543210?text=Hi', { target: 'whatsapp' }],
    ['https://api.whatsapp.com/send?phone=91', { target: 'whatsapp' }],
    ['https://maps.app.goo.gl/abc', { target: 'map' }],
    ['https://www.google.com/maps/place/Latte', { target: 'map' }],
    ['https://maps.google.co.in/?q=Latte', { target: 'map' }],
    ['https://www.instagram.com/latte', { target: 'social', label: 'instagram' }],
    ['https://m.facebook.com/latte', { target: 'social', label: 'facebook' }],
    ['https://youtu.be/xyz', { target: 'social', label: 'youtube' }],
    ['https://www.zomato.com/latte', { target: 'link', label: 'zomato.com' }],
  ])('%s', (href, want) => {
    expect(classifyLink(href, SITE)).toEqual(want)
  })

  it('ignores links within the site and anything that is not a link', () => {
    expect(classifyLink(`https://${SITE}/#services`, SITE)).toBeNull()
    expect(classifyLink('#contact', SITE)).toBeNull()
    expect(classifyLink('javascript:void(0)', SITE)).toBeNull()
    expect(classifyLink('https://google.com/search?q=maps', SITE)).toEqual({ target: 'link', label: 'google.com' })
  })
})

describe('visitorGeo', () => {
  it('takes a CDN country with its region and city', () => {
    const h = headers({ 'cloudfront-viewer-country': 'in', 'cloudfront-viewer-country-region-name': 'Karnataka', 'cloudfront-viewer-city': 'Bengaluru' })
    expect(visitorGeo(h, 'America/New_York', 'en-US')).toEqual({ country: 'IN', region: 'Karnataka', city: 'Bengaluru' })
  })

  it('falls back to the time zone, then the locale, never guessing a region', () => {
    expect(visitorGeo(headers({ 'cf-ipcountry': 'XX' }), 'Asia/Dubai', 'en-IN')).toEqual({ country: 'AE', region: null, city: null })
    expect(visitorGeo(headers(), 'Etc/UTC', 'hi-IN')).toEqual({ country: 'IN', region: null, city: null })
    expect(visitorGeo(headers(), undefined, 'en')).toEqual({ country: null, region: null, city: null })
  })
})

describe('visitorKey', () => {
  it('is stable per site, differs across sites and carries no IP', () => {
    const a = visitorKey('site-1', '203.0.113.7', 'UA')
    expect(a).toBe(visitorKey('site-1', '203.0.113.7', 'UA'))
    expect(a).not.toBe(visitorKey('site-2', '203.0.113.7', 'UA'))
    expect(a).toMatch(/^[0-9a-f]{32}$/)
  })
})
