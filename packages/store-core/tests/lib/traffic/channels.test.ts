import { describe, it, expect } from 'vitest'
import { classifyChannel, referrerHost, selfHostsFor, sourceLabel } from '@/lib/traffic/channels'
import { GOOGLE_ADS_CHANNEL, UNATTRIBUTED_CHANNEL } from '@/lib/analytics/traffic-sources'

describe('channel grouping', () => {
  it('treats ad click ids as paid', () => {
    expect(classifyChannel({ googleClick: true, source: 'newsletter', medium: 'email' })).toBe('paid_search')
    expect(classifyChannel({ metaClick: true })).toBe('paid_social')
  })

  it('reads paid mediums', () => {
    expect(classifyChannel({ source: 'google', medium: 'cpc' })).toBe('paid_search')
    expect(classifyChannel({ source: 'bing', medium: 'ppc' })).toBe('paid_search')
    expect(classifyChannel({ source: 'facebook', medium: 'cpc' })).toBe('paid_social')
    expect(classifyChannel({ source: 'ig', medium: 'paid_social' })).toBe('paid_social')
  })

  it('groups UTM-tagged organic traffic', () => {
    expect(classifyChannel({ source: 'newsletter' })).toBe('email')
    expect(classifyChannel({ source: 'crm', medium: 'whatsapp' })).toBe('email')
    expect(classifyChannel({ source: 'instagram', medium: 'social' })).toBe('organic_social')
    expect(classifyChannel({ source: 'jeffi', campaign: 'social_42' })).toBe('organic_social')
    expect(classifyChannel({ source: 'google', medium: 'organic' })).toBe('organic_search')
    expect(classifyChannel({ source: 'amazon' })).toBe('marketplace')
    expect(classifyChannel({ source: 'partnerblog', medium: 'referral' })).toBe('referral')
  })

  it('falls back to the referring site', () => {
    expect(classifyChannel({})).toBe('direct')
    expect(classifyChannel({ referrerHost: 'google.co.in' })).toBe('organic_search')
    expect(classifyChannel({ referrerHost: 'l.facebook.com' })).toBe('organic_social')
    expect(classifyChannel({ referrerHost: 't.co' })).toBe('organic_social')
    expect(classifyChannel({ referrerHost: 'mail.google.com' })).toBe('email')
    expect(classifyChannel({ referrerHost: 'amazon.in' })).toBe('marketplace')
    expect(classifyChannel({ referrerHost: 'someblog.example' })).toBe('referral')
  })

  it('counts the store itself as direct', () => {
    expect(classifyChannel({ referrerHost: 'jeffistores.in' }, ['jeffistores.in'])).toBe('direct')
    expect(classifyChannel({ referrerHost: 'shop.jeffistores.in' }, ['jeffistores.in'])).toBe('direct')
    expect(classifyChannel({ referrerHost: 'localhost' })).toBe('direct')
  })

  it('labels sources as the Sources report does', () => {
    expect(sourceLabel({ googleClick: true, source: 'x' })).toBe(GOOGLE_ADS_CHANNEL)
    expect(sourceLabel({ source: 'Facebook' })).toBe('facebook')
    expect(sourceLabel({})).toBe(UNATTRIBUTED_CHANNEL)
  })

  it('parses referrer hosts and the store hosts', () => {
    expect(referrerHost('https://www.Google.com/search?q=x')).toBe('google.com')
    expect(referrerHost('android-app://com.google')).toBe('com.google')
    expect(referrerHost('')).toBeNull()
    expect(referrerHost('not a url')).toBeNull()
    expect(selfHostsFor('admin.jeffistores.in:443', 'https://jeffistores.in')).toEqual(['jeffistores.in'])
    expect(selfHostsFor('admin-acme.jeffistores.in', null)).toEqual(['jeffistores.in'])
    expect(selfHostsFor(null, null)).toEqual([])
  })
})
