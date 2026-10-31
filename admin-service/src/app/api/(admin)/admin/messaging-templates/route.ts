import { NextRequest } from 'next/server'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'

// List: v2 three-level library (template_family/template/variant/version) with platform defaults
// merged under tenant overrides. Response shape: { items: ListItem[] }.
// forward() re-appends the request's query string, so pass the bare path.
export const GET = (req: NextRequest) => proxyAdminMessaging(req, '/v2/templates', 'templates:read')

// Create: v2 upsert.
export const POST = (req: NextRequest) => proxyAdminMessaging(req, '/v2/templates', 'templates:write')
