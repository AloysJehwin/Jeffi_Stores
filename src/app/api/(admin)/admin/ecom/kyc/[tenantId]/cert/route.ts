import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { getKyc } from '@/lib/tenant-registry'
import { getKycDocumentStream } from '@/lib/catalog/kyc-upload'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tenantId } = await params
  const kyc = await getKyc(tenantId)
  if (!kyc?.gst_cert_s3_key) return NextResponse.json({ error: 'No certificate on file' }, { status: 404 })

  const { body, contentType } = await getKycDocumentStream(kyc.gst_cert_s3_key)
  return new NextResponse(body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="gst-cert-${tenantId}"`,
    },
  })
}
