// Minimal Next.js request/response stand-ins so admin handlers lifted from the monolith stay
// near-verbatim. Auth already happened in the Next proxy; claims arrive in the service token.
import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify'
import type { ServiceClaims } from '@jeffi/service-auth'
import { lookupTenantContextById, runWithTenant } from '@jeffi/tenancy'

export class NextResponse {
  constructor(public body: any, public init: { status?: number; headers?: Record<string, string> } = {}) {}
  static json(body: any, init: { status?: number } = {}) {
    const r = new NextResponse(JSON.stringify(body), { status: init.status ?? 200, headers: { 'content-type': 'application/json' } })
    return r
  }
  static redirect(url: string, status = 302) {
    return new NextResponse(null, { status, headers: { location: url } })
  }
}

export interface NextRequest {
  url: string
  nextUrl: URL
  method: string
  headers: Headers
  json(): Promise<any>
  claims: ServiceClaims
}

export interface AdminClaims {
  principalId: string
  tenantId: string
  role: string
  scopes: string[]
}

export async function authenticateAdmin(req: NextRequest): Promise<AdminClaims | null> {
  const c = req.claims
  if (!c?.internal || !c.adminId) return null
  return { principalId: c.adminId, tenantId: c.tenantId, role: c.role ?? '', scopes: c.scopes ?? [] }
}

export async function authenticateAnyUser(req: NextRequest): Promise<{ userId: string } | null> {
  const c = req.claims
  return c?.internal && c.userId ? { userId: c.userId } : null
}

type Handler = (req: NextRequest, ctx: { params: Promise<any> }) => Promise<NextResponse>

export function mount(app: FastifyInstance, method: HTTPMethods, path: string, handler: Handler) {
  app.route({
    method,
    url: path,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const c = req.claims
      if (!c?.internal) return reply.code(403).send({ error: 'forbidden', message: 'Internal calls only' })
      const tenant = await lookupTenantContextById(c.tenantId)
      if (!tenant) return reply.code(404).send({ error: 'tenant_not_found' })
      const base = `http://documents${req.url}`
      const shim: NextRequest = {
        url: base,
        nextUrl: new URL(base),
        method: req.method,
        headers: new Headers(Object.entries(req.headers).filter(([, v]) => typeof v === 'string') as [string, string][]),
        json: async () => {
          if (req.body == null || req.body === '') throw new Error('No body')
          return req.body
        },
        claims: c,
      }
      const res = await runWithTenant(tenant, () => handler(shim, { params: Promise.resolve(req.params as Record<string, string>) }), c.adminId ?? null)
      reply.code(res.init.status ?? 200)
      for (const [k, v] of Object.entries(res.init.headers ?? {})) reply.header(k, v)
      if (res.body == null) return reply.send()
      return reply.send(res.body instanceof Uint8Array ? Buffer.from(res.body) : res.body)
    },
  })
}
