import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAdminScope } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { DEFAULT_MESSAGE_PRICING, RATE_ROWS } from '@jeffi/pricing'
import { loadMessagePricing, saveMessagePricing } from '@/lib/billing/message-pricing'
import { loadUsdInr } from '@/lib/billing/fx'
import { getProviderPolicy } from '@/lib/providers/policy'

export const dynamic = 'force-dynamic'

// The message pricing sheet: per provider and channel, the cost per message, the processing fee and whether the charge
// follows the provider's reported price; plus margin and media fee, and the live USD→INR rate (read-only). Platform admin only.

function platformOnly(admin: Awaited<ReturnType<typeof requireAdminScope>>) {
  if (admin instanceof NextResponse) return admin
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  return admin
}

async function view(force = false) {
  const fx = await loadUsdInr({ wait: true })
  const [sheet, policy] = await Promise.all([loadMessagePricing(force), getProviderPolicy().catch(() => null)])
  return {
    sheet,
    fx,
    defaults: DEFAULT_MESSAGE_PRICING,
    rows: RATE_ROWS,
    // The provider each channel uses now (Configuration → Providers); email always goes through SES.
    active: { sms: policy?.smsProvider ?? 'twilio', whatsapp: policy?.whatsappProvider ?? 'twilio', email: 'ses' },
  }
}

export async function GET(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:read'))
  if (admin instanceof NextResponse) return admin
  return NextResponse.json(await view(true))
}

const Rate = z.object({ costInr: z.number().min(0).max(1000), feeInr: z.number().min(0).max(100), exact: z.boolean() })
const Body = z.object({
  marginPct: z.number().min(0).max(500),
  mediaInr: z.number().min(0).max(100),
  rates: z.record(z.string(), Rate),
})

export async function PUT(req: NextRequest) {
  const admin = platformOnly(await requireAdminScope(req, 'ecom_billing:write'))
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Every price must be a number: cost up to ₹1,000, fee up to ₹100, margin 0–500%.' }, { status: 400 })
  const unknown = Object.keys(parsed.data.rates).filter(k => !RATE_ROWS.some(r => r.key === k))
  if (unknown.length) return NextResponse.json({ error: `Unknown provider/channel: ${unknown.join(', ')}` }, { status: 400 })
  await saveMessagePricing(parsed.data)
  return NextResponse.json(await view(true))
}
