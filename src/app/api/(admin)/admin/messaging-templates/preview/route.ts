import { NextRequest } from 'next/server'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'
import { brandFields } from '@/lib/shared/send-by-template'

// Same branded shell as real sends: merge brand/kicker/footer into the preview request.
export const POST = async (req: NextRequest) => {
  const body = { ...(await req.json().catch(() => ({}))), ...(await brandFields('email')) }
  const headers = new Headers(req.headers) // keep the admin session cookie
  headers.set('content-type', 'application/json')
  headers.delete('content-length')
  const forwarded = new NextRequest(req.url, { method: 'POST', headers, body: JSON.stringify(body) })
  return proxyAdminMessaging(forwarded, '/v2/templates/preview', 'templates:read')
}
