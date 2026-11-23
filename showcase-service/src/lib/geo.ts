// A visitor's country (and region and city when the edge says) without looking up their IP. The storefront keeps no
// visitor location at all (its Traffic locations come from order addresses), so this is Showcase's own: a CDN geo
// header when one is in front, else the browser's time zone, else its locale's region.

type Headers = { get(name: string): string | null }

const COUNTRY_HEADERS = ['cloudfront-viewer-country', 'cf-ipcountry', 'x-vercel-ip-country', 'x-country-code']
const REGION_HEADERS = ['cloudfront-viewer-country-region-name', 'x-vercel-ip-country-region', 'cloudfront-viewer-country-region']
const CITY_HEADERS = ['cloudfront-viewer-city', 'x-vercel-ip-city']

// The zones most visitors come from; anything else falls back to the locale.
const ZONES: Record<string, string> = {
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Dubai': 'AE', 'Asia/Muscat': 'OM', 'Asia/Qatar': 'QA', 'Asia/Riyadh': 'SA',
  'Asia/Kuwait': 'KW', 'Asia/Bahrain': 'BH', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Kathmandu': 'NP', 'Asia/Katmandu': 'NP',
  'Asia/Colombo': 'LK', 'Asia/Thimphu': 'BT', 'Indian/Maldives': 'MV', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY',
  'Asia/Bangkok': 'TH', 'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Hong_Kong': 'HK',
  'Asia/Shanghai': 'CN', 'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Taipei': 'TW', 'Europe/London': 'GB', 'Europe/Dublin': 'IE',
  'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Amsterdam': 'NL', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Zurich': 'CH',
  'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Brussels': 'BE', 'Europe/Vienna': 'AT',
  'Europe/Warsaw': 'PL', 'Europe/Lisbon': 'PT', 'Europe/Helsinki': 'FI', 'Europe/Moscow': 'RU', 'Europe/Istanbul': 'TR',
  'America/New_York': 'US', 'America/Chicago': 'US', 'America/Denver': 'US', 'America/Phoenix': 'US', 'America/Los_Angeles': 'US',
  'America/Anchorage': 'US', 'Pacific/Honolulu': 'US', 'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA',
  'America/Sao_Paulo': 'BR', 'America/Mexico_City': 'MX', 'Australia/Sydney': 'AU', 'Australia/Melbourne': 'AU', 'Australia/Brisbane': 'AU',
  'Australia/Perth': 'AU', 'Australia/Adelaide': 'AU', 'Pacific/Auckland': 'NZ', 'Africa/Johannesburg': 'ZA', 'Africa/Lagos': 'NG',
  'Africa/Nairobi': 'KE', 'Africa/Cairo': 'EG',
}

const first = (h: Headers, names: string[]) => {
  for (const n of names) {
    const v = h.get(n)?.trim()
    if (v) return v
  }
  return null
}

function decoded(v: string | null, max: number): string | null {
  if (!v) return null
  let s = v
  try {
    s = decodeURIComponent(v)
  } catch {}
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return s ? s.slice(0, max) : null
}

export interface Geo {
  country: string | null
  region: string | null
  city: string | null
}

export function visitorGeo(h: Headers, timezone?: string | null, language?: string | null): Geo {
  const edge = first(h, COUNTRY_HEADERS)?.toUpperCase()
  const fromEdge = edge && /^[A-Z]{2}$/.test(edge) && edge !== 'XX' && edge !== 'T1' ? edge : null
  const fromZone = timezone ? ZONES[timezone] ?? null : null
  const fromLocale = /^[a-z]{2,3}-([A-Z]{2})\b/i.exec(language ?? '')?.[1]?.toUpperCase() ?? null
  return {
    country: fromEdge ?? fromZone ?? fromLocale,
    region: fromEdge ? decoded(first(h, REGION_HEADERS), 80) : null,
    city: fromEdge ? decoded(first(h, CITY_HEADERS), 80) : null,
  }
}
