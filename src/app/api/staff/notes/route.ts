import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, isStaffDenied } from '@/lib/staff-auth'
import { hasScope } from '@/lib/scopes'
import { zUuid } from '@/lib/validate'
import { listNotes, createNote, addAttachment, getNote, MAX_ATTACHMENTS } from '@/lib/customer-notes'
import { notifyOwnersOfNote } from '@/lib/customer-notes-notify'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request, 'customers:read')
  if (isStaffDenied(auth)) return auth
  const customerId = zUuid.safeParse(request.nextUrl.searchParams.get('customerId'))
  if (!customerId.success) return NextResponse.json({ error: 'customerId required' }, { status: 400 })
  const orderId = request.nextUrl.searchParams.get('orderId')
  return NextResponse.json({ notes: await listNotes({ userId: customerId.data, orderId: orderId || null, limit: 30 }) })
}

function parseTags(fd: FormData): string[] {
  const raw = fd.get('tags')
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try { return JSON.parse(raw) } catch { return [] }
  }
  return fd.getAll('tags').map(String)
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request, 'customers:write')
  if (isStaffDenied(auth)) return auth
  const { session } = auth
  if (!hasScope(session.role, session.scopes, 'customers:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const fd = await request.formData().catch(() => null)
  if (!fd) return NextResponse.json({ error: 'Expected multipart form data' }, { status: 400 })

  const customerId = zUuid.safeParse(fd.get('customerId'))
  if (!customerId.success) return NextResponse.json({ error: 'customerId required' }, { status: 400 })
  const orderIdRaw = String(fd.get('orderId') || '')
  const returnIdRaw = String(fd.get('returnRequestId') || '')
  const orderId = orderIdRaw ? zUuid.safeParse(orderIdRaw) : null
  const returnRequestId = returnIdRaw ? zUuid.safeParse(returnIdRaw) : null
  if ((orderId && !orderId.success) || (returnRequestId && !returnRequestId.success)) {
    return NextResponse.json({ error: 'Invalid order reference' }, { status: 400 })
  }

  const files = fd.getAll('files').filter((f): f is File => f instanceof File && f.size > 0)
  if (files.length > MAX_ATTACHMENTS) return NextResponse.json({ error: `Maximum ${MAX_ATTACHMENTS} attachments` }, { status: 400 })
  const title = String(fd.get('title') || '').trim()
  const body = String(fd.get('body') || '').trim()
  if (!title && !body && files.length === 0) {
    return NextResponse.json({ error: 'Add a title, a note, or at least one photo/recording' }, { status: 400 })
  }

  let durations: Record<string, number> = {}
  try { durations = JSON.parse(String(fd.get('durations') || '{}')) } catch { durations = {} }

  const created = await createNote({
    userId: customerId.data,
    adminId: session.adminId,
    body, title: title || null,
    tags: parseTags(fd),
    orderId: orderId?.success ? orderId.data : null,
    returnRequestId: returnRequestId?.success ? returnRequestId.data : null,
    sharedWithCustomer: String(fd.get('shared')) === 'true',
    source: 'staff_form',
  })
  if ('error' in created) return NextResponse.json({ error: created.error }, { status: 400 })
  if (!created.id) return NextResponse.json({ note: null, warnings: [] }, { status: 201 })

  const warnings: string[] = []
  for (let i = 0; i < files.length; i++) {
    const r = await addAttachment(created.id, files[i], { durationSeconds: durations[String(i)] ?? null, displayOrder: i })
    if ('error' in r) warnings.push(`${files[i].name || `file ${i + 1}`}: ${r.error}`)
  }

  const note = await getNote(created.id)
  if (note) notifyOwnersOfNote(note, { email: session.email, name: session.name }).catch(() => {})
  return NextResponse.json({ note, warnings }, { status: 201 })
}
