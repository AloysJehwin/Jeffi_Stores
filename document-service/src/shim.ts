import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify'
import { lookupTenantContextById, runAsPlatform, runWithTenant, PLATFORM_TENANT_ID } from '@jeffi/tenancy'
import { NextRequest } from './next'

export { NextRequest, NextResponse } from './next'
export * from './auth'

type Handler = (req: NextRequest, ctx: { params: Promise<any> }) => Promise<Response>

export function mount(app: FastifyInstance, method: HTTPMethods, path: string, handler: Handler) {
  app.route({
    method,
    url: path,
    handler: async (req: FastifyRequest, reply: FastifyReply) => {
      const c = req.claims
      if (!c?.internal) return reply.code(403).send({ error: 'forbidden', message: 'Internal calls only' })
      // The platform's own store calls with the platform tenant id: no tenant in scope, main DB.
      const platform = c.tenantId === PLATFORM_TENANT_ID
      const tenant = platform ? null : await lookupTenantContextById(c.tenantId)
      if (!platform && !tenant) return reply.code(404).send({ error: 'tenant_not_found' })
      const hasBody = req.body != null && req.method !== 'GET' && req.method !== 'HEAD'
      const shim = new NextRequest(`http://documents${req.url}`, {
        method: req.method,
        headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string') as [string, string][],
        body: hasBody ? JSON.stringify(req.body) : undefined,
      })
      shim.claims = c
      const run = () => handler(shim, { params: Promise.resolve(req.params as Record<string, string>) })
      const res = await (tenant ? runWithTenant(tenant, run, c.adminId ?? null) : runAsPlatform(run, c.adminId ?? null))
      reply.code(res.status)
      res.headers.forEach((v, k) => reply.header(k, v))
      const buf = Buffer.from(await res.arrayBuffer())
      return reply.send(buf.length ? buf : undefined)
    },
  })
}
