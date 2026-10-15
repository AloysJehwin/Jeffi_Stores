import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/shared/db'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/auth/jwt'

const ATTR_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'gbraid', 'wbraid'] as const

function attrValue(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 255) : null
}

const PAGE_TYPES = new Set(['home', 'categories', 'category', 'product', 'cart', 'checkout', 'order_placed', 'search'])

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sessionId, page, path, referrer } = body
    const attr = body.attribution && typeof body.attribution === 'object' ? body.attribution : {}

    // page is a type from PageTracker.classifyPage (varchar(32)), not a URL; reject anything else as 400.
    if (!sessionId || !path || typeof page !== 'string' || !PAGE_TYPES.has(page) || String(sessionId).length > 64) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
    const ua = req.headers.get('user-agent') || null

    let userId: string | null = null
    try {
      const cookieStore = await cookies()
      const token = cookieStore.get('user_sid')?.value
      if (token) {
        const payload = (await verifyToken(token)) as any
        userId = payload?.userId || null
      }
    } catch {}

    await query(
      `INSERT INTO page_events (session_id, user_id, page, path, referrer, ip_address, user_agent,
         utm_source, utm_medium, utm_campaign, gclid, gbraid, wbraid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [sessionId, userId, page, path, referrer || null, ip, ua, ...ATTR_KEYS.map(k => attrValue(attr[k]))]
    )

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[route]', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
