import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin, type AdminJWTPayload } from '@/lib/jwt'
import { hasScope } from '@/lib/scopes'
import { z } from 'zod'
import { parseBody } from '@/lib/validate'
import { applyDraftPatch, endsBeforeStart, withHomepageDraft, type DraftSection } from '@/lib/homepage-draft'

export const dynamic = 'force-dynamic'

// `type` is deliberately absent: changing a section's type orphans its config, so the admin
// deletes and re-adds instead.
const COLUMN_MAP: Record<string, string> = {
  title: 'title',
  subtitle: 'subtitle',
  eyebrow: 'eyebrow',
  ctaLabel: 'cta_label',
  ctaUrl: 'cta_url',
  config: 'config',
  isActive: 'is_active',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
}

const patchSchema = z.object({
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

async function guard(request: NextRequest): Promise<AdminJWTPayload | NextResponse> {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'settings:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return admin
}

type PatchOutcome = { section: DraftSection } | { error: string; status: 400 | 404 }

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin
  const { id } = await params

  const parsed = parseBody(patchSchema, await request.json())
  if (!parsed.ok) return parsed.response

  const updates: Record<string, unknown> = {}
  for (const [key, column] of Object.entries(COLUMN_MAP)) {
    if (!(key in parsed.data)) continue
    const raw = (parsed.data as Record<string, unknown>)[key]
    updates[column] = column === 'config' ? (raw ?? {}) : (raw ?? null)
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'No fields to update' }, { status: 400 })

  const outcome = await withHomepageDraft<PatchOutcome>(admin.adminId, draft => {
    const section = draft.sections.find(s => s.id === id)
    if (!section) return { error: 'Not found', status: 404 }
    const next = { ...section, ...updates }
    if (endsBeforeStart(next.starts_at, next.ends_at)) {
      return { error: 'The end time must be after the start time', status: 400 }
    }
    applyDraftPatch(section, updates)
    return { section }
  })
  if ('error' in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status })

  return NextResponse.json({ section: outcome.section })
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await guard(request)
  if (admin instanceof NextResponse) return admin
  const { id } = await params

  await withHomepageDraft(admin.adminId, draft => {
    draft.sections = draft.sections.filter(s => s.id !== id)
  })
  return NextResponse.json({ success: true })
}
