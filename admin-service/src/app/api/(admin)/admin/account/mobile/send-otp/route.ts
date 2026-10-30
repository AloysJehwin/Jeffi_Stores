import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { sendAdminMobileCode } from '@/lib/auth/admin-mobile'
import { resolveTenantId } from '@/lib/tenancy/tenant-context'
import { currentBrandNameAsync } from '@/lib/catalog/brand'
import { parseBody } from '@/lib/shared/validate'

export const dynamic = 'force-dynamic'

const Schema = z.object({ phone: z.string().min(6).max(24) })

export async function POST(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const parsed = parseBody(Schema, await request.json().catch(() => null))
  if (!parsed.ok) return parsed.response
  const [store, storeName] = await Promise.all([resolveTenantId().catch(() => null), currentBrandNameAsync()])
  const r = await sendAdminMobileCode(store, admin.adminId, parsed.data.phone, storeName)
  if (!r.ok) return NextResponse.json({ error: r.error, retryAfter: r.retryAfter }, { status: r.status })
  return NextResponse.json({ channel: r.channel, retryAfter: r.retryAfter })
}
