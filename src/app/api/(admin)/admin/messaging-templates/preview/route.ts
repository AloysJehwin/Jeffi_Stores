import { NextRequest } from 'next/server'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'
import { brandFields } from '@/lib/shared/send-by-template'

// Same branded shell as real sends: merge brand/kicker/footer into the preview request.
export const POST = async (req: NextRequest) => {
  const body = { ...(await req.json().catch(() => ({}))), ...(await brandFields('email')) }
  const forwarded = new NextRequest(req.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return proxyAdminMessaging(forwarded, '/v2/templates/preview', 'templates:read')
}
