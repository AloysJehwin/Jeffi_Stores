import { NextRequest } from 'next/server'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'

// List: proxies to the legacy /templates endpoint (listTemplates) which is tenant-scoped already.
export const GET = (req: NextRequest) => {
  const qs = new URL(req.url).search
  return proxyAdminMessaging(req, `/templates${qs}`, 'templates:read')
}

// Create: v2 upsert.
export const POST = (req: NextRequest) => proxyAdminMessaging(req, '/v2/templates', 'templates:write')
