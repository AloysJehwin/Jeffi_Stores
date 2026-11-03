import { NextRequest, NextResponse } from 'next/server'
import { actorOf, draftLockResponse, epochFrom, withDraftWrite } from '@/lib/admin/draft-locks'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { queryOne } from '@/lib/shared/db'
import { canHoldVaultFiles } from '@/lib/catalog/digital-guard'
import {
  reserveUpload,
  completeUpload,
  listFiles,
  setDownloadable,
  deleteFile,
  VaultFileError,
} from '@/lib/vault/files'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ id: string }>
}

async function productExists(productId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(`SELECT id FROM products WHERE id = $1`, [productId])
  return !!row
}

/**
 * ?draft=<id>: the product draft being edited. Writes in a draft need its lock; they stay in the
 * draft (staged uploads, pending removals/toggles) until publish. Returns a response on refusal.
 */
async function draftOf(req: NextRequest, productId: string, admin: { adminId?: string; role?: string; scopes?: string[] }, write: boolean) {
  const asked = req.nextUrl.searchParams.get('draft')
  if (!asked) return { draftId: null as string | null }
  const row = await queryOne<{ id: string }>(`SELECT id FROM product_drafts WHERE id = $1 AND product_id = $2`, [asked, productId])
  if (!row) return { draftId: null, res: NextResponse.json({ error: 'Draft not found' }, { status: 404 }) }
  if (write) {
    try {
      await withDraftWrite(actorOf(admin), 'product', row.id, async () => {}, { epoch: epochFrom(req) })
    } catch (err) {
      const locked = draftLockResponse(err)
      if (locked) return { draftId: null, res: locked }
      throw err
    }
  }
  return { draftId: row.id }
}

function fail(err: unknown): NextResponse {
  if (err instanceof VaultFileError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error('[vault files]', err)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}

// GET /api/admin/products/:id/files — list a product's vault files.
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'vault:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  if (!(await productExists(id))) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  try {
    const d = await draftOf(request, id, admin, false)
    if (d.res) return d.res
    return NextResponse.json({ files: await listFiles(id, d.draftId) })
  } catch (err) {
    return fail(err)
  }
}

// POST /api/admin/products/:id/files
//   { action:'reserve', display_name, mime_type, declared_bytes } → { session_id, upload_url, mime_type, kind, ... }
//   { action:'complete', session_id, downloadable? }              → { file }
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'vault:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  if (!(await productExists(id))) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
  if (!(await canHoldVaultFiles(id)))
    return NextResponse.json({ error: 'Product is not digital' }, { status: 409 })
  const d = await draftOf(request, id, admin, true)
  if (d.res) return d.res

  try {
    if (body.action === 'reserve') {
      const r = await reserveUpload({
        productId: id,
        displayName: String(body.display_name || ''),
        mimeType: String(body.mime_type || ''),
        declaredBytes: Number(body.declared_bytes),
        uploadedBy: admin.adminId,
      })
      return NextResponse.json({
        session_id: r.sessionId,
        upload_url: r.uploadUrl,
        storage_key: r.storageKey,
        storage_driver: r.storageDriver,
        kind: r.kind,
        mime_type: r.mimeType,
      })
    }
    if (body.action === 'complete') {
      if (!body.session_id) return NextResponse.json({ error: 'session_id required' }, { status: 400 })
      const file = await completeUpload({
        productId: id,
        sessionId: String(body.session_id),
        downloadable: !!body.downloadable,
        uploadedBy: admin.adminId,
        draftId: d.draftId,
      })
      return NextResponse.json({ file })
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (err) {
    return fail(err)
  }
}

// PATCH /api/admin/products/:id/files — toggle a file's per-file downloadable flag.
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'vault:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const body = await request.json().catch(() => null)
  if (!body?.file_id) return NextResponse.json({ error: 'file_id required' }, { status: 400 })
  const d = await draftOf(request, id, admin, true)
  if (d.res) return d.res
  try {
    const ok = await setDownloadable(id, String(body.file_id), !!body.downloadable, d.draftId)
    if (!ok) return NextResponse.json({ error: 'File not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return fail(err)
  }
}

// DELETE /api/admin/products/:id/files?file_id=... — remove a file + decrement usage.
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(request)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'vault:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const fileId = request.nextUrl.searchParams.get('file_id')
  if (!fileId) return NextResponse.json({ error: 'file_id required' }, { status: 400 })
  const d = await draftOf(request, id, admin, true)
  if (d.res) return d.res
  try {
    const ok = await deleteFile(id, fileId, d.draftId)
    if (!ok) return NextResponse.json({ error: 'File not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return fail(err)
  }
}
