import { NextRequest } from 'next/server'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'

export const POST = (req: NextRequest) => proxyAdminMessaging(req, '/v2/templates/preview', 'templates:read')
