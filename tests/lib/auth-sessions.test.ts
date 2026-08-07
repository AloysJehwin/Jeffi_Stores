import { describe, it, expect } from 'vitest'
import { uaFingerprint, uaClearlyDiffers } from '@/lib/auth-sessions'

// Device-binding fingerprint: browser family + OS family, versions DROPPED so routine
// auto-updates never force a re-login, but a genuinely different browser/device does.

const CHROME_MAC_139 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const CHROME_MAC_140 = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const CHROME_WIN      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
const EDGE_WIN        = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0'
const SAFARI_IOS      = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const SAFARI_MAC      = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'
const FF_WIN          = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0'
const CHROME_ANDROID  = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'

describe('uaFingerprint', () => {
  it('classifies common browser/OS families', () => {
    expect(uaFingerprint(CHROME_MAC_139)).toBe('chrome|macos')
    expect(uaFingerprint(SAFARI_IOS)).toBe('safari|ios')
    expect(uaFingerprint(SAFARI_MAC)).toBe('safari|macos')
    expect(uaFingerprint(FF_WIN)).toBe('firefox|windows')
    expect(uaFingerprint(EDGE_WIN)).toBe('edge|windows')
    expect(uaFingerprint(CHROME_ANDROID)).toBe('chrome|android')
  })

  it('drops version numbers (139 and 140 fingerprint identically)', () => {
    expect(uaFingerprint(CHROME_MAC_139)).toBe(uaFingerprint(CHROME_MAC_140))
  })

  it('returns null for absent or unclassifiable UAs', () => {
    expect(uaFingerprint(null)).toBeNull()
    expect(uaFingerprint(undefined)).toBeNull()
    expect(uaFingerprint('')).toBeNull()
    expect(uaFingerprint('curl/8.0')).toBeNull()
    expect(uaFingerprint('PostmanRuntime/7.0')).toBeNull()
  })
})

describe('uaClearlyDiffers', () => {
  it('does NOT flag a version-only change (auto-update)', () => {
    expect(uaClearlyDiffers(CHROME_MAC_139, CHROME_MAC_140)).toBe(false)
  })

  it('flags a different browser on the same OS (e.g. Chrome vs Edge on Windows)', () => {
    expect(uaClearlyDiffers(CHROME_WIN, EDGE_WIN)).toBe(true)
  })

  it('flags a different OS / device family', () => {
    expect(uaClearlyDiffers(CHROME_MAC_139, SAFARI_IOS)).toBe(true)
    expect(uaClearlyDiffers(CHROME_MAC_139, CHROME_ANDROID)).toBe(true)
    expect(uaClearlyDiffers(CHROME_MAC_139, FF_WIN)).toBe(true)
  })

  it('fails OPEN when either UA is null/unknown (never a false re-auth)', () => {
    expect(uaClearlyDiffers(null, CHROME_MAC_139)).toBe(false)
    expect(uaClearlyDiffers(CHROME_MAC_139, null)).toBe(false)
    expect(uaClearlyDiffers('curl/8.0', 'PostmanRuntime/7.0')).toBe(false)
    expect(uaClearlyDiffers('curl/8.0', CHROME_MAC_139)).toBe(false)
  })
})
