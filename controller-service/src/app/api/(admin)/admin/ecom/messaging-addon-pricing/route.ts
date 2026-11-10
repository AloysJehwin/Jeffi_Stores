import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { controlPlanePool } from '@/lib/tenant-registry'
import {
  DEFAULT_MESSAGING_COST_LINES,
  DEFAULT_MESSAGING_MARGIN_PCT,
  getMessagingAddonPricing,
  invalidateMessagingAddonPricing,
} from '@/lib/billing/messaging-addon'

export const dynamic = 'force-dynamic'

// The SMS & WhatsApp add-on fee: monthly cost lines per store plus a margin. Platform admin only.

function platformOnly(admin: Awaited<ReturnType<typeof requireAdminScope>>) {
  if (admin instanceof NextResponse) return admin
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return admin
}

const view = async () => ({ ...(await getMessagingAddonPricing()), defaults: { costLines: DEFAULT_MESSAGING_COST_LINES, marginPct: DEFAULT_MESSAGING_MARGIN_PCT } })

export async function GET(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:read'))
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await view())
}

const Body = z.object({
  costLines: z.array(z.object({ label: z.string().trim().min(1).max(120), inrMonth: z.number().min(0).max(100000) })).min(1).max(20),
  marginPct: z.number().min(0).max(500),
})

export async function PUT(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:write'))
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Each cost needs a name and a monthly amount; margin 0–500%.' }, { status: 400 })
  await controlPlanePool().query(
    `INSERT INTO platform_infra (key, value) VALUES ('messaging_addon_pricing', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(parsed.data)]
  )
  invalidateMessagingAddonPricing()
  return NextResponse.json(await view())
}
