import { describe, it, expect } from 'vitest'
import { parseUserAgent } from '@/lib/traffic/user-agent'

const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
const ANDROID_PHONE = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0 Mobile Safari/537.36'
const ANDROID_TAB = 'Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1'
const WIN_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0'
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0'
const BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

describe('parseUserAgent', () => {
  it('reads device, browser and OS', () => {
    expect(parseUserAgent(MAC_CHROME)).toEqual({ device: 'Desktop', browser: 'Chrome', os: 'macOS' })
    expect(parseUserAgent(IPHONE)).toEqual({ device: 'Mobile', browser: 'Safari', os: 'iOS' })
    expect(parseUserAgent(ANDROID_PHONE)).toEqual({ device: 'Mobile', browser: 'Samsung Internet', os: 'Android' })
    expect(parseUserAgent(ANDROID_TAB)).toEqual({ device: 'Tablet', browser: 'Chrome', os: 'Android' })
    expect(parseUserAgent(IPAD)).toEqual({ device: 'Tablet', browser: 'Chrome', os: 'iOS' })
    expect(parseUserAgent(WIN_EDGE)).toEqual({ device: 'Desktop', browser: 'Edge', os: 'Windows' })
    expect(parseUserAgent(FIREFOX)).toEqual({ device: 'Desktop', browser: 'Firefox', os: 'Linux' })
  })

  it('flags bots and copes with nothing', () => {
    expect(parseUserAgent(BOT).device).toBe('Bot')
    expect(parseUserAgent(null)).toEqual({ device: 'Desktop', browser: 'Unknown', os: 'Unknown' })
  })
})
