import { NextRequest, NextResponse } from 'next/server'

export interface RateLimitConfig {
  windowSecs: number
  max: number
}

const TIERS: Array<{ pattern: RegExp; config: RateLimitConfig }> = [
  { pattern: /^\/api\/auth\/send-otp/,        config: { windowSecs: 60,  max: 5   } },
  { pattern: /^\/api\/auth\/verify-otp/,      config: { windowSecs: 60,  max: 10  } },
  { pattern: /^\/api\/auth\/login/,           config: { windowSecs: 60,  max: 10  } },
  { pattern: /^\/api\/auth\/signup/,          config: { windowSecs: 60,  max: 5   } },
  { pattern: /^\/api\/auth\//,                config: { windowSecs: 60,  max: 20  } },
  { pattern: /^\/api\/search/,               config: { windowSecs: 10,  max: 20  } },
  { pattern: /^\/api\/products/,             config: { windowSecs: 10,  max: 30  } },
  { pattern: /^\/api\/coupons/,              config: { windowSecs: 60,  max: 10  } },
  { pattern: /^\/api\/orders\/create/,       config: { windowSecs: 60,  max: 10  } },
  { pattern: /^\/api\/upload/,               config: { windowSecs: 60,  max: 20  } },
  { pattern: /^\/api\/forms\//,              config: { windowSecs: 60,  max: 10  } },
  { pattern: /^\/api\/support\//,            config: { windowSecs: 10,  max: 15  } },
  { pattern: /^\/api\/webhooks\//,           config: { windowSecs: 10,  max: 200 } },
  { pattern: /^\/api\//,                     config: { windowSecs: 10,  max: 60  } },
]

const memStore = new Map<string, { count: number; expiry: number }>()

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1'
  )
}

function getTier(pathname: string): RateLimitConfig | null {
  for (const { pattern, config } of TIERS) {
    if (pattern.test(pathname)) return config
  }
  return null
}

async function redisIncrExpire(key: string, windowSecs: number): Promise<{ count: number; ttl: number } | null> {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!redisUrl || !redisToken) return null

  try {
    const [incrRes, expireRes] = await Promise.all([
      fetch(`${redisUrl}/incr/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${redisToken}` },
      }),
      fetch(`${redisUrl}/expire/${encodeURIComponent(key)}/${windowSecs}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${redisToken}` },
      }),
    ])

    const incrData = await incrRes.json()
    const count = incrData.result as number

    if (count === 1) {
      await expireRes
    }

    const ttlRes = await fetch(`${redisUrl}/ttl/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${redisToken}` },
    })
    const ttlData = await ttlRes.json()
    const ttl = ttlData.result as number

    return { count, ttl: ttl > 0 ? ttl : windowSecs }
  } catch {
    return null
  }
}

function memIncrExpire(key: string, windowSecs: number): { count: number; ttl: number } {
  const now = Date.now()
  const entry = memStore.get(key)

  if (!entry || now > entry.expiry) {
    const expiry = now + windowSecs * 1000
    memStore.set(key, { count: 1, expiry })
    return { count: 1, ttl: windowSecs }
  }

  entry.count++
  const ttl = Math.ceil((entry.expiry - now) / 1000)
  return { count: entry.count, ttl }
}

export async function applyRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl
  const config = getTier(pathname)
  if (!config) return null

  const ip = getClientIp(request)
  const pathKey = pathname.split('/').slice(0, 4).join('/')
  const key = `rl:${ip}:${pathKey}`

  const result = (await redisIncrExpire(key, config.windowSecs)) ?? memIncrExpire(key, config.windowSecs)

  if (result.count > config.max) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(result.ttl),
          'X-RateLimit-Limit': String(config.max),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + result.ttl),
        },
      }
    )
  }

  return null
}
