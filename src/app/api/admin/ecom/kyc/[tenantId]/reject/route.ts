import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/jwt'
import { rejectKyc, getKyc, getOwnerById } from '@/lib/tenant-registry'
import { sendKycRejectedEmail } from '@/lib/ecom-emails'

export const dynamic = 'force-dynamic'

const Schema = z.object({ note: z.string().min(1) })

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = await params
  const raw = await request.json().catch(() => null)
  const parsed = Schema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: 'Rejection note is required' }, { status: 400 })

  await rejectKyc(tenantId, admin.email ?? 'admin', parsed.data.note)

  // Notify owner
  const kyc = await getKyc(tenantId).catch(() => null)
  if (kyc) {
    const owner = await getOwnerById(kyc.owner_id).catch(() => null)
    if (owner) sendKycRejectedEmail({ email: owner.email, name: owner.name }, parsed.data.note).catch(() => {})
  }

  return NextResponse.json({ ok: true })
}
