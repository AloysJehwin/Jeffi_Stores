import { NextRequest, NextResponse } from 'next/server'
import { authenticateAdmin } from '@/lib/auth/jwt'
import { hasScope } from '@/lib/auth/scopes'
import { zUuid } from '@/lib/shared/validate'
import {
  listNotes,
  createNote,
  addAttachment,
  getNote,
  deleteNote,
  setNoteShared,
  MAX_ATTACHMENTS,
} from '@/lib/shared/customer-notes'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:read'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const orderId = req.nextUrl.searchParams.get('orderId')
  const returnRequestId = req.nextUrl.searchParams.get('returnRequestId')
  const notes = await listNotes({ userId: id, orderId: orderId || null, returnRequestId: returnRequestId || null })
  return NextResponse.json({ notes })
}

function parseTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'string' && v.trim().startsWith('[')) {
    try {
      return JSON.parse(v)
    } catch {
      return []
    }
  }
  return []
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  let title = '',
    body = '',
    tags: string[] = [],
    orderId: string | null = null,
    returnRequestId: string | null = null,
    shared = false
  let files: File[] = []
  const ct = req.headers.get('content-type') || ''
  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData().catch(() => null)
    if (!fd) return NextResponse.json({ error: 'Invalid form data' }, { status: 400 })
    title = String(fd.get('title') || '').trim()
    body = String(fd.get('body') || '').trim()
    tags = fd.getAll('tags').length ? fd.getAll('tags').map(String) : parseTags(fd.get('tags'))
    orderId = String(fd.get('orderId') || '') || null
    returnRequestId = String(fd.get('returnRequestId') || '') || null
    shared = String(fd.get('shared')) === 'true'
    files = fd.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  } else {
    const j = await req.json().catch(() => ({}))
    title = String(j.title || '').trim()
    body = String(j.body || '').trim()
    tags = parseTags(j.tags)
    orderId = j.orderId || j.order_id || null
    returnRequestId = j.returnRequestId || j.return_request_id || null
    shared = j.shared === true
  }
  if (
    (orderId && !zUuid.safeParse(orderId).success) ||
    (returnRequestId && !zUuid.safeParse(returnRequestId).success)
  ) {
    return NextResponse.json({ error: 'Invalid order reference' }, { status: 400 })
  }
  if (!title && !body && files.length === 0)
    return NextResponse.json({ error: 'Note body is required' }, { status: 400 })
  if (body.length > 2000) return NextResponse.json({ error: 'Note too long (max 2000 chars)' }, { status: 400 })
  if (files.length > MAX_ATTACHMENTS)
    return NextResponse.json({ error: `Maximum ${MAX_ATTACHMENTS} attachments` }, { status: 400 })

  const created = await createNote({
    userId: id,
    adminId: admin.adminId,
    body,
    title: title || null,
    tags,
    orderId,
    returnRequestId,
    sharedWithCustomer: shared,
    source: 'admin_panel',
  })
  if ('error' in created) return NextResponse.json({ error: created.error }, { status: 400 })
  if (!created.id) return NextResponse.json({ success: true, note: null, warnings: [] })

  const warnings: string[] = []
  for (let i = 0; i < files.length; i++) {
    const r = await addAttachment(created.id, files[i], { displayOrder: i })
    if ('error' in r) warnings.push(`${files[i].name || `file ${i + 1}`}: ${r.error}`)
  }
  return NextResponse.json({ success: true, note: await getNote(created.id), warnings })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { noteId, shared } = await req.json().catch(() => ({}))
  if (!zUuid.safeParse(noteId).success || typeof shared !== 'boolean') {
    return NextResponse.json({ error: 'noteId and shared (boolean) are required' }, { status: 400 })
  }
  const ok = await setNoteShared(noteId, id, shared)
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true, shared })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const admin = await authenticateAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!hasScope(admin.role, admin.scopes, 'customers:write'))
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const noteId = req.nextUrl.searchParams.get('noteId')
  if (!noteId) return NextResponse.json({ error: 'noteId query param required' }, { status: 400 })
  await deleteNote(noteId, id)
  return NextResponse.json({ success: true })
}
