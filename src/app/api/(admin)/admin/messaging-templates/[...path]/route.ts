import { NextRequest } from 'next/server'
import { proxyAdminMessaging } from '@/lib/messaging/proxy'

const scopeFor = (method: string) => (method === 'GET' ? 'templates:read' : 'templates:write')

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params
  return proxyAdminMessaging(req, `/v2/templates/${path.join('/')}`, scopeFor(req.method))
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const DELETE = handle
