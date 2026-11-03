import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { actorOf, readJson, withPlan } from '@/lib/channels/route'
import { runChange } from '@/lib/channels/change-log'
import { readSetting, writeSettings } from '@/lib/google-ads/notify'
import { SETTING_ORDERS } from '@/lib/amazon/orders'
import { SETTING_BUFFER, SETTING_STOCK } from '@/lib/amazon/stock'

export const dynamic = 'force-dynamic'

const Body = z.object({ importOrders: z.boolean(), pushStock: z.boolean(), buffer: z.number().int().min(0).max(1000) })

/** Turns Amazon order import and stock push on or off, and sets the safety buffer. */
export async function PUT(request: NextRequest) {
  const admin = await withPlan(await requireAdminScope(request, 'amazon_orders:write'), 'amazon_orders:write', 'Amazon orders')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await readJson(request))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid settings' }, { status: 400 })
  const b = parsed.data
  const before = {
    importOrders: (await readSetting(SETTING_ORDERS)) === 'true',
    pushStock: (await readSetting(SETTING_STOCK)) === 'true',
    buffer: Number((await readSetting(SETTING_BUFFER)) ?? 0),
  }
  const out = await runChange(
    {
      channel: 'amazon',
      action: 'orders.settings',
      entityType: 'settings',
      summary: `Amazon order import ${b.importOrders ? 'on' : 'off'}, stock push ${b.pushStock ? 'on' : 'off'}, buffer ${b.buffer}`,
      before,
      after: b,
      apply: () => writeSettings({ [SETTING_ORDERS]: String(b.importOrders), [SETTING_STOCK]: String(b.pushStock), [SETTING_BUFFER]: String(b.buffer) }),
    },
    actorOf(admin),
    false
  )
  return NextResponse.json(out, { status: out.ok ? 200 : 400 })
}
