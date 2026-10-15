import { NextRequest } from 'next/server'
import { proxyAdminDocs } from '@/lib/documents/proxy'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return proxyAdminDocs(request, '/admin/quotations/products', 'quotations:read')
}
