import { describe, it, expect } from 'vitest'
import {
  effectiveDownloadable,
  subscribeAllowed,
  digitalActive,
  fileFormats,
  resolveDigitalUi,
} from '@/lib/catalog/digital'

describe('effectiveDownloadable', () => {
  it('requires both master and the product/file flag', () => {
    expect(effectiveDownloadable(true, true)).toBe(true)
    expect(effectiveDownloadable(true, false)).toBe(false)
    expect(effectiveDownloadable(false, true)).toBe(false)
    expect(effectiveDownloadable(false, false)).toBe(false)
  })
})

describe('subscribeAllowed', () => {
  it('requires both master and is_subscription', () => {
    expect(subscribeAllowed(true, true)).toBe(true)
    expect(subscribeAllowed(true, false)).toBe(false)
    expect(subscribeAllowed(false, true)).toBe(false)
  })
})

describe('digitalActive', () => {
  it('requires both master and is_digital', () => {
    expect(digitalActive(true, true)).toBe(true)
    expect(digitalActive(false, true)).toBe(false)
    expect(digitalActive(true, false)).toBe(false)
  })
})

describe('fileFormats', () => {
  it('splits file_format on comma and slash and trims', () => {
    expect(fileFormats('PDF, EPUB')).toEqual(['PDF', 'EPUB'])
    expect(fileFormats('MP3/WAV')).toEqual(['MP3', 'WAV'])
  })

  it('merges platform_compatibility and de-dupes case-insensitively', () => {
    expect(fileFormats('PDF', ['pdf', 'Windows'])).toEqual(['PDF', 'Windows'])
  })

  it('returns [] for empty input', () => {
    expect(fileFormats(null, null)).toEqual([])
    expect(fileFormats('', [])).toEqual([])
  })
})

describe('resolveDigitalUi', () => {
  const allOn = { digitalProductsEnabled: true, subscriptionsEnabled: true, vaultDownloadsEnabled: true }

  it('is inert when the product is not digital', () => {
    const ui = resolveDigitalUi(allOn, {
      isDigital: false,
      isSubscription: true,
      downloadable: true,
      fileFormat: 'PDF',
    })
    expect(ui).toEqual({ isDigital: false, subscribe: false, download: false, formats: [] })
  })

  it('is inert when the digital master is off even if the product is digital', () => {
    const ui = resolveDigitalUi(
      { digitalProductsEnabled: false, subscriptionsEnabled: true, vaultDownloadsEnabled: true },
      { isDigital: true, isSubscription: true, downloadable: true, fileFormat: 'PDF' }
    )
    expect(ui.isDigital).toBe(false)
    expect(ui.subscribe).toBe(false)
    expect(ui.download).toBe(false)
    expect(ui.formats).toEqual([])
  })

  it('resolves subscribe/download/formats under their own masters', () => {
    const ui = resolveDigitalUi(allOn, {
      isDigital: true,
      isSubscription: true,
      downloadable: true,
      fileFormat: 'PDF, EPUB',
      platformCompatibility: ['iOS'],
    })
    expect(ui).toEqual({ isDigital: true, subscribe: true, download: true, formats: ['PDF', 'EPUB', 'iOS'] })
  })

  it('gates download and subscribe on their respective masters independently', () => {
    const ui = resolveDigitalUi(
      { digitalProductsEnabled: true, subscriptionsEnabled: false, vaultDownloadsEnabled: false },
      { isDigital: true, isSubscription: true, downloadable: true }
    )
    expect(ui.isDigital).toBe(true)
    expect(ui.subscribe).toBe(false)
    expect(ui.download).toBe(false)
  })
})
