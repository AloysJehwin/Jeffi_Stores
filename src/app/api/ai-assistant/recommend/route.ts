import { NextRequest, NextResponse } from 'next/server'
import { authenticateUser } from '@/lib/jwt'
import { recommendProducts, getRemainingQuota } from '@/lib/ai-assistant'
import { z } from 'zod'
import { parseBody, zNonEmpty, zUuid } from '@/lib/validate'

export const dynamic = 'force-dynamic'

const postSchema = z.object({
  query: zNonEmpty.max(500),
  categoryId: zUuid.nullish(),
})

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

  const parsed = parseBody(postSchema, { query: body.query, categoryId: body.categoryId })
  if (!parsed.ok) return parsed.response

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
