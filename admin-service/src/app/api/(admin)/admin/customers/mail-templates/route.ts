import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { listPageTemplates } from '@/lib/messaging/library'
import { pageTag } from '@/lib/messaging/placements'

export const dynamic = 'force-dynamic'

// GET — the store's email templates set to show on the customer page.
export async function GET(request: NextRequest) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read')) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  const templates = await listPageTemplates(pageTag('customer')).catch(() => [])
  return NextResponse.json({ templates: templates.map(({ slug, name, subject, preheader, body }) => ({ slug, name, subject, preheader, body })) })
}
