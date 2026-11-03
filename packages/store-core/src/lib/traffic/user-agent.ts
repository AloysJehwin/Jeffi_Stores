// Coarse user-agent parsing for the Traffic report: device type, browser and OS.

export type Device = 'Mobile' | 'Tablet' | 'Desktop' | 'Bot'

export interface ParsedUa {
  device: Device
  browser: string
  os: string
}

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|curl|wget|python-requests|axios|node-fetch/i

export function parseUserAgent(ua: string | null | undefined): ParsedUa {
  const s = ua ?? ''
  if (!s) return { device: 'Desktop', browser: 'Unknown', os: 'Unknown' }
  return { device: device(s), browser: browser(s), os: os(s) }
}

function device(s: string): Device {
  if (BOT.test(s)) return 'Bot'
  if (/ipad|tablet|kindle|silk|playbook/i.test(s) || (/android/i.test(s) && !/mobile/i.test(s))) return 'Tablet'
  if (/mobi|iphone|ipod|android|windows phone|opera mini|blackberry/i.test(s)) return 'Mobile'
  return 'Desktop'
}

function browser(s: string): string {
  if (/edg(e|a|ios)?\//i.test(s)) return 'Edge'
  if (/opr\/|opera/i.test(s)) return 'Opera'
  if (/samsungbrowser/i.test(s)) return 'Samsung Internet'
  if (/firefox|fxios/i.test(s)) return 'Firefox'
  if (/chromium/i.test(s)) return 'Chromium'
  if (/chrome|crios/i.test(s)) return 'Chrome'
  if (/safari/i.test(s)) return 'Safari'
  return 'Other'
}

function os(s: string): string {
  if (/iphone|ipad|ipod/i.test(s)) return 'iOS'
  if (/android/i.test(s)) return 'Android'
  if (/windows/i.test(s)) return 'Windows'
  if (/cros/i.test(s)) return 'ChromeOS'
  if (/mac os x|macintosh/i.test(s)) return 'macOS'
  if (/linux/i.test(s)) return 'Linux'
  return 'Other'
}
