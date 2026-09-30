import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { authenticateAdmin, type AdminJWTPayload } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { z } from 'zod'
import { parseBody } from '@/lib/shared/validate'
import { SECTION_TYPES, type SectionType } from '@/lib/catalog/homepage-sections'
import {
  applyDraftOrder,
  endsBeforeStart,
  getEditableHomepage,
  nextDisplayOrder,
  withHomepageDraft,
  type DraftSection,
} from '@/lib/catalog/homepage-draft'

export const dynamic = 'force-dynamic'

async function guard(request: NextRequest): Promise<AdminJWTPayload | NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return admin
}

export async function GET(request: NextRequest) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin
  const { sections } = await getEditableHomepage()
  return NextResponse.json({ sections })
}

const bodySchema = z.object({
  type: z.enum(SECTION_TYPES as [string, ...string[]]),
  title: z.string().max(255).nullish(),
  subtitle: z.string().max(500).nullish(),
  eyebrow: z.string().max(100).nullish(),
  ctaLabel: z.string().max(100).nullish(),
  ctaUrl: z.string().max(2000).nullish(),
  config: z.record(z.string(), z.unknown()).optional(),
  isActive: z.boolean().optional(),
  startsAt: z.string().datetime().nullish(),
  endsAt: z.string().datetime().nullish(),
})

export async function POST(request: NextRequest) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin

  const parsed = parseBody(bodySchema, await request.json())
  if (!parsed.ok) return parsed.response
  const d = parsed.data
  if (endsBeforeStart(d.startsAt, d.endsAt)) {
    return NextResponse.json({ error: 'The end time must be after the start time' }, { status: 400 })
  }

  const section = await withHomepageDraft(admin.adminId, draft => {
    const now = new Date().toISOString()
    const row: DraftSection = {
      id: randomUUID(),
      type: d.type as SectionType,
      title: d.title ?? null,
      subtitle: d.subtitle ?? null,
      eyebrow: d.eyebrow ?? null,
      cta_label: d.ctaLabel ?? null,
      cta_url: d.ctaUrl ?? null,
      config: d.config ?? {},
      display_order: nextDisplayOrder(draft.sections),
      is_active: d.isActive ?? true,
      starts_at: d.startsAt ?? null,
      ends_at: d.endsAt ?? null,
      created_at: now,
      updated_at: now,
    }
    draft.sections.push(row)
    return row
  })

  return NextResponse.json({ section })
}

export async function PATCH(request: NextRequest) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin

  const body = await request.json().catch(() => ({}))
  const order: string[] = Array.isArray(body?.order) ? body.order : []
  if (order.length === 0) return NextResponse.json({ error: 'order[] required' }, { status: 400 })

  await withHomepageDraft(admin.adminId, draft => {
    draft.sections = applyDraftOrder(draft.sections, order)
  })

  return NextResponse.json({ success: true })
}
