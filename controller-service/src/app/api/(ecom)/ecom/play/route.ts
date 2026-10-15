import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { SendMessageRequest, RenderDocumentRequest, DocumentType } from '@jeffi/api-contracts'
import { ownerApi } from '@/lib/ecom/owner-api'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { hasService, listServiceApprovals, blockedServices } from '@/lib/tenant-registry'
import { fetchService } from '@/lib/ecom/service-client'
import { parseBody } from '@/lib/shared/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const keyId = z.object({ apiKeyId: z.string().uuid() })
const schema = z.union([
  keyId.extend({ kind: z.literal('message') }).and(SendMessageRequest),
  keyId.extend({ kind: z.literal('document'), type: DocumentType }).and(RenderDocumentRequest),
])

// Dashboard "Play": runs one real send/render on behalf of the owner's chosen API key — recorded
// and billed against that key exactly as a /v1 call would be.
export async function POST(request: NextRequest) {
  const ctx = await ownerApi(request)
  if (ctx instanceof NextResponse) return ctx
  const parsed = parseBody(schema, await request.json().catch(() => ({})))
  if (!parsed.ok) return parsed.response
  const { apiKeyId, kind, ...rest } = parsed.data as { apiKeyId: string; kind: 'message' | 'document'; type?: string } & Record<string, unknown>
  const service = kind === 'message' ? 'messaging' : 'documents'
  const scope = kind === 'message' ? 'messages:send' : 'documents:render'

  const k = await controlPlanePool().query(`SELECT id, scopes FROM api_keys WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [apiKeyId, ctx.tenant.id])
  if (!k.rows[0]) return NextResponse.json({ error: 'API key not found' }, { status: 404 })
  if (!(k.rows[0].scopes as string[] ?? []).includes(scope)) return NextResponse.json({ error: 'insufficient_scope', message: `This key needs the ${scope} scope.` }, { status: 403 })
  if (!hasService(ctx.tenant, service)) return NextResponse.json({ error: `${service} is not enabled for this workspace` }, { status: 403 })
  const gate = blockedServices(await listServiceApprovals(ctx.tenant.id)).get(service)
  if (gate) return NextResponse.json({
    error: gate === 'rejected' ? 'service_rejected' : 'service_pending_approval',
    message: gate === 'rejected' ? `Your ${service} access was not approved. Contact support@jeffistores.in.` : `Your ${service} access is under review — sending starts once Jeffi approves it.`,
  }, { status: 403 })

  const { type, ...body } = rest
  const path = kind === 'message' ? '/messages' : `/documents/${type}`
  const res = await fetchService(service, ctx.tenant, path, { method: 'POST', body, apiKeyId, internal: false, space: 'api' })
  await controlPlanePool().query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [apiKeyId]).catch(() => {})
  const out = await res.json().catch(() => ({}))
  if (kind === 'document' && res.ok && out?.id) out.pdf_url = `/api/ecom/svc/documents/documents/${out.id}/pdf`
  return NextResponse.json(out, { status: res.status })
}
