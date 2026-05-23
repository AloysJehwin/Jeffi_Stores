import { NextRequest, NextResponse } from 'next/server'
import { getRedisClient } from './redis'

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

export async function applyRateLimit(request: NextRequest): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl
  const config = getTier(pathname)
  if (!config) return null

  const ip = getClientIp(request)
  const pathKey = pathname.split('/').slice(0, 4).join('/')
  const key = `rl:${ip}:${pathKey}`

  try {
    const redis = getRedisClient()
    const count = await redis.incr(key)
    if (count === 1) {
      await (redis as any).expire(key, config.windowSecs)
    }

    if (count > config.max) {
      const ttl = await redis.ttl(key)
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(ttl > 0 ? ttl : config.windowSecs),
            'X-RateLimit-Limit': String(config.max),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + (ttl > 0 ? ttl : config.windowSecs)),
          },
        }
      )
    }

    return null
  } catch {
    return null
  }
}
