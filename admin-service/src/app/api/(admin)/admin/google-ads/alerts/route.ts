import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import {
  AlertConfigSchema,
  dismissAlert,
  getAlertConfig,
  getNotifySettings,
  listAlerts,
  runAdsAlerts,
  saveAlertSettings,
} from '@/lib/google-ads/alerts'
import { readJson } from '@/lib/google-ads/manage-route'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function payload() {
  const [alerts, config, notify] = await Promise.all([listAlerts(), getAlertConfig(), getNotifySettings()])
  return { alerts, config, notify }
}

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await payload())
}

const SettingsSchema = z.object({ config: AlertConfigSchema, notify: z.object({ emails: z.boolean(), digest: z.boolean() }) })

// Thresholds, alert emails and the weekly digest switch.
export async function PUT(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  const parsed = SettingsSchema.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || 'Invalid settings' }, { status: 400 })
  await saveAlertSettings(parsed.data.config, parsed.data.notify)
  return NextResponse.json(await payload())
}

const ActionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('dismiss'), id: z.string().regex(/^\d{1,18}$/) }),
  z.object({ op: z.literal('evaluate') }),
])

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'google_ads:write')
  if (admin instanceof NextResponse) return admin
  const parsed = ActionSchema.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (parsed.data.op === 'dismiss') await dismissAlert(parsed.data.id, admin.email ?? admin.adminId ?? null)
  else await runAdsAlerts()
  return NextResponse.json(await payload())
}
