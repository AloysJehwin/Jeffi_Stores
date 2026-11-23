import { describe, it, expect } from 'vitest'
import { FLAGSHIP_GOOGLE_TAG_ID, googleTagId, gtagHeadSnippet } from '../src/google-tag'

describe('googleTagId', () => {
  it('normalises and accepts GT/G/AW ids', () => {
    expect(googleTagId('gt-nm2c3m85')).toBe('GT-NM2C3M85') // uppercases
    expect(googleTagId(' G-ABCD1234 ')).toBe('G-ABCD1234') // trims
    expect(googleTagId('AW-12345')).toBe('AW-12345')
    expect(googleTagId(FLAGSHIP_GOOGLE_TAG_ID)).toBe(FLAGSHIP_GOOGLE_TAG_ID)
  })
  it('rejects non-matching ids', () => {
    expect(googleTagId('X-1234')).toBeNull()
    expect(googleTagId('GT-')).toBeNull() // too short body
    expect(googleTagId('')).toBeNull()
    expect(googleTagId(null)).toBeNull()
    expect(googleTagId(undefined)).toBeNull()
    expect(googleTagId(12345)).toBeNull() // not a tag shape
  })
})

describe('gtagHeadSnippet', () => {
  it('returns empty string for an invalid id', () => {
    expect(gtagHeadSnippet('nope')).toBe('')
  })
  it('emits the loader, consent default and config for a valid id', () => {
    const s = gtagHeadSnippet('GT-NM2C3M85')
    expect(s).toContain('gtag/js?id=GT-NM2C3M85')
    expect(s).toContain("gtag('consent','default'")
    expect(s).toContain('ad_storage:\'denied\'')
    expect(s).toContain("gtag('config',\"GT-NM2C3M85\")")
    expect(s).not.toContain('content_group')
    expect(s).not.toContain("gtag('event'")
  })
  it('adds a content_group config argument when given', () => {
    const s = gtagHeadSnippet('GT-NM2C3M85', { contentGroup: 'docs' })
    expect(s).toContain('"content_group":"docs"')
  })
  it('appends an event call after the page view', () => {
    const s = gtagHeadSnippet('GT-NM2C3M85', { event: { name: 'purchase', params: { value: 10 } } })
    expect(s).toContain('gtag(\'event\',"purchase",{"value":10})')
  })
  it('defaults event params to {} when omitted', () => {
    const s = gtagHeadSnippet('GT-NM2C3M85', { event: { name: 'view' } })
    expect(s).toContain('gtag(\'event\',"view",{})')
  })
  it('escapes < in json to avoid closing the script tag', () => {
    const s = gtagHeadSnippet('GT-NM2C3M85', { contentGroup: '</script>' })
    expect(s).not.toContain('</script>"}') // the injected value is escaped
    expect(s).toContain('\\u003c')
  })
})
