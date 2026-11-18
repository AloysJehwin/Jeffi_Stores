import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createSiteDraft, listSiteDrafts } from '@/lib/site/store'
import { requireAdminScope } from '@/lib/auth/jwt'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:read')
  if (admin instanceof NextResponse) return admin
  return NextResponse.json({ drafts: await listSiteDrafts() })
}

const Body = z.object({ title: z.string().max(120).nullish() })

export async function POST(request: NextRequest) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const parsed = Body.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'The draft name is too long' }, { status: 400 })
  return NextResponse.json({ id: await createSiteDraft(admin.adminId, parsed.data.title) })
}
