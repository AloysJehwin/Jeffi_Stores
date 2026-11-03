import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { parseBody } from '@/lib/shared/validate'
import { NOTIFICATION_CATEGORIES, getPreferences, savePreferences } from '@/lib/push/preferences'

export const dynamic = 'force-dynamic'

const UpdateSchema = z.object({
  categories: z
    .array(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORIES),
        push: z.boolean().optional(),
        email: z.boolean().optional(),
        sms: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
      })
    )
    .min(1)
    .max(NOTIFICATION_CATEGORIES.length),
})

async function reply(userId: string) {
  const p = await getPreferences(userId)
  return NextResponse.json({ categories: p.categories, marketing_opt_out: p.marketingOptOut })
}

export async function GET(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    return await reply(user.userId)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await authenticateAnyUser(request)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parsed = parseBody(UpdateSchema, await request.json().catch(() => null), 'notification-preferences')
    if (!parsed.ok) return parsed.response
    await savePreferences(user.userId, parsed.data.categories)
    return await reply(user.userId)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
