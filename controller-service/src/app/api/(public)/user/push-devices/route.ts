import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAnyUser } from '@/lib/auth/jwt'
import { parseBody } from '@/lib/shared/validate'
import { registerDevice } from '@/lib/push/devices'
import { carryOffersOptIn } from '@/lib/push/preferences'

export const dynamic = 'force-dynamic'

const validZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const DeviceSchema = z.object({
  token: z.string().trim().min(20).max(512),
  platform: z.enum(['android', 'ios']),
  app_version: z.string().trim().max(40).nullish(),
  os_version: z.string().trim().max(40).nullish(),
  locale: z.string().trim().max(35).nullish(),
  timezone: z
    .string()
    .trim()
    .max(64)
    .nullish()
    .transform(v => (v && validZone(v) ? v : null)),
  offers_opt_in: z.boolean().optional(),
})

// Called on every app launch, on token refresh and after sign-in. Works signed out (a guest
// install); signed in, it attaches the device to the user.
export async function POST(request: NextRequest) {
  try {
    const parsed = parseBody(DeviceSchema, await request.json().catch(() => null), 'push-devices')
    if (!parsed.ok) return parsed.response
    const b = parsed.data
    const user = await authenticateAnyUser(request)
    const device = await registerDevice(
      {
        token: b.token,
        platform: b.platform,
        appVersion: b.app_version,
        osVersion: b.os_version,
        locale: b.locale,
        timezone: b.timezone,
        offersOptIn: b.offers_opt_in,
      },
      user?.userId ?? null
    )
    if (user && device?.offers_opt_in) await carryOffersOptIn(user.userId)
    return NextResponse.json({ ok: true, id: device?.id ?? null, signed_in: !!user, offers_opt_in: !!device?.offers_opt_in })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
