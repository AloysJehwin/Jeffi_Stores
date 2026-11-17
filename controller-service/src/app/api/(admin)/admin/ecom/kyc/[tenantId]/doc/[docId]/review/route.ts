import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { getOwnerById, getTenant } from '@/lib/tenant-registry'
import { todayIst } from '@controller/lib/catalog/compliance'
import { getComplianceDocument, reviewComplianceDocument } from '@controller/lib/catalog/compliance-docs'
import { CONSOLE_STATUSES, notifyDocumentRejected } from '@controller/lib/catalog/compliance-notify'

export const dynamic = 'force-dynamic'

// `version`: the file the admin looked at (its S3 key), so a copy the owner sent since is not decided unseen.
const Schema = z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(1000).optional(), version: z.string().max(512).optional() })

// Approve or reject one licence or certificate (tenant_compliance_documents), with an optional note the owner sees on the
// console's Licences & certificates page. Who and when are kept on the row. A rejection puts the store's licences in need
// of action and, once the store has its console, emails the owner; during the application review the KYC decision does.
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string; docId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const parsed = Schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Choose approve or reject' }, { status: 400 })
  const { decision } = parsed.data
  const note = parsed.data.note || null

  const { tenantId, docId } = await params
  const doc = await getComplianceDocument(tenantId, docId)
  if (!doc) return NextResponse.json({ error: 'No such document on file' }, { status: 404 })
  const stale = NextResponse.json({ error: 'The owner sent a new copy meanwhile. Reload to review it.' }, { status: 409 })
  if (parsed.data.version && parsed.data.version !== doc.s3_key) return stale
  const today = todayIst()
  if (decision === 'approved' && doc.expires_on && doc.expires_on < today)
    return NextResponse.json({ error: 'It has expired: only the renewed one the owner sends can be approved.' }, { status: 409 })

  const updated = await reviewComplianceDocument(tenantId, docId, decision, admin.email ?? 'admin', note, parsed.data.version ?? null, today)
  if (!updated) return stale

  if (decision === 'rejected') {
    const [tenant, owner] = await Promise.all([getTenant(tenantId).catch(() => null), getOwnerById(updated.owner_id).catch(() => null)])
    if (tenant && owner?.email && CONSOLE_STATUSES.includes(tenant.status))
      notifyDocumentRejected({ email: owner.email, name: owner.name }, tenant.display_name || tenant.slug, updated, note).catch(e =>
        console.warn('[compliance] rejection email not sent', updated.doc_type, e?.message || e)
      )
  }
  return NextResponse.json({ ok: true, document: updated })
}
