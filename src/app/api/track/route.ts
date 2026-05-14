import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { cookies } from 'next/headers'
import { verifyToken } from '@/lib/jwt'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { sessionId, page, path, referrer } = body

    if (!sessionId || !page || !path) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
    const ua = req.headers.get('user-agent') || null

    let userId: string | null = null
    try {
      const token = cookies().get('user_token')?.value
      if (token) {
        const payload = await verifyToken(token) as any
        userId = payload?.userId || payload?.id || null
      }
    } catch {}

    await query(
      `INSERT INTO page_events (session_id, user_id, page, path, referrer, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, userId, page, path, referrer || null, ip, ua]
    )

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
