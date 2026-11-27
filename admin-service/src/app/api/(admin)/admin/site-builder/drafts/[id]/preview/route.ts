import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { signHomepagePreviewToken } from '@/lib/catalog/homepage-preview-token'
import { getSiteDraft } from '@/lib/site/store'
import { noAppDenial } from '../../../_no-app'

export const dynamic = 'force-dynamic'

// GET ?audience=store|business: a short-lived token the store's own host accepts to render this draft (the canvas).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope(request, 'settings:write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  const noApp = await noAppDenial(request.nextUrl.searchParams.get('layout'))
  if (noApp) return noApp
  if (!(await getSiteDraft(id))) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
  const audience = request.nextUrl.searchParams.get('audience') === 'business' ? 'business' : 'store'
  return NextResponse.json({ token: await signHomepagePreviewToken({ draftId: id, audience, kind: 'site' }) })
}
