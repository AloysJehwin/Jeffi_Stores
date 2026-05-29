import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { recommendProducts, getRemainingQuota } from '@/lib/ai-assistant'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await authenticateUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const quota = await getRemainingQuota(user.userId)
  return NextResponse.json({ quota })
}

export async function POST(req: NextRequest) {
  const user = await authenticateUser(req)
  if (!user) return NextResponse.json({ error: 'Sign in to use the AI assistant' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const query = String(body?.query ?? '').trim()
  if (query.length < 5) {
    return NextResponse.json({ error: 'Please describe your project in at least a few words.' }, { status: 400 })
  }
  if (query.length > 500) {
    return NextResponse.json({ error: 'Please keep your message under 500 characters.' }, { status: 400 })
  }

  try {
    const result = await recommendProducts(user.userId, query)
    const quota = await getRemainingQuota(user.userId)
    return NextResponse.json({ ...result, quota })
  } catch (err: any) {
    const message = String(err?.message ?? 'AI request failed')
    const isLimit = message.includes('Daily limit')
    return NextResponse.json({ error: message }, { status: isLimit ? 429 : 500 })
  }
}
