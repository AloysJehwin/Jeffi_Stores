import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, isStaffDenied } from '@/lib/auth/staff-auth'
import { hasScope } from '@/lib/auth/scopes'
import { getNote, deleteNote } from '@/lib/shared/customer-notes'

export const dynamic = 'force-dynamic'

// Staff may only remove their own notes; anything else is an admin-panel action.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff(request, 'customers:write')
  if (isStaffDenied(auth)) return auth
  const { session } = auth
  if (!hasScope(session.role, session.scopes, 'customers:write')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  const { id } = await params
  const note = await getNote(id)
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (note.adminId !== session.adminId)
    return NextResponse.json({ error: 'You can only delete your own notes' }, { status: 403 })
  await deleteNote(note.id, note.userId)
  return NextResponse.json({ success: true })
}
