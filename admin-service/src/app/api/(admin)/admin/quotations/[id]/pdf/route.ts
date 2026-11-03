import { NextRequest } from 'next/server'
import { proxyAdminDocs } from '@/lib/documents/proxy'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return proxyAdminDocs(request, `/admin/quotations/${id}/pdf`, 'quotations:read')
}
