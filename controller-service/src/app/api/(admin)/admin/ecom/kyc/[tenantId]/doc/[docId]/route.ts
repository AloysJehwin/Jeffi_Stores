import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { isPlatformAdmin } from '@/lib/auth/scopes'
import { getKycDocumentStream } from '@controller/lib/catalog/kyc-upload'
import { getComplianceDocument } from '@controller/lib/catalog/compliance-docs'

export const dynamic = 'force-dynamic'

// One licence or certificate a store submitted with its application (tenant_compliance_documents), for the KYC review.
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string; docId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isPlatformAdmin(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { tenantId, docId } = await params
  const doc = await getComplianceDocument(tenantId, docId)
  if (!doc) return NextResponse.json({ error: 'No such document on file' }, { status: 404 })

  const { body, contentType } = await getKycDocumentStream(doc.s3_key)
  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${doc.doc_type}-${tenantId}"`,
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
