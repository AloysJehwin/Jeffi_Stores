import { NextRequest } from 'next/server'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'

export const POST = (req: NextRequest) => proxyAdminMessaging(req, '/wa/sync-approval', 'templates:write')
