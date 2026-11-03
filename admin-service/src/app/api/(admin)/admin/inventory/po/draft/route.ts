import { NextRequest } from 'next/server'
import { proxyAdminDocs } from '@/lib/documents/proxy'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return proxyAdminDocs(request, '/admin/inventory/po/draft', 'inventory:write')
}

export async function POST(request: NextRequest) {
  return proxyAdminDocs(request, '/admin/inventory/po/draft', 'inventory:write')
}
