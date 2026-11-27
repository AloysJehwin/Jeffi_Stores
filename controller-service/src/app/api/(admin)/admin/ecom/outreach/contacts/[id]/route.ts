import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { getContactDetail } from '@controller/lib/outreach/contacts'
import { addSuppression } from '@controller/lib/outreach/suppress'
import { ensureRun } from '@controller/lib/outreach/agent/runtime'
import * as runs from '@controller/lib/outreach/agent/runs'
import { transition, InvalidTransitionError, ContactNotFoundError } from '@controller/lib/outreach/state'

export const dynamic = 'force-dynamic'

const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id)

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!isId(id)) return NextResponse.json({ error: 'Invalid contact id' }, { status: 400 })
  try {
    const detail = await getContactDetail(id)
    if (!detail) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    return NextResponse.json(detail)
  } catch (e) {
    return serverError(e)
  }
}

const Patch = z.object({
  action: z.enum(['suppress', 'requeue', 'not_interested', 'handoff', 'resume']),
  note: z.string().trim().max(500).optional(),
})

// PATCH { action } → the manual moves only: suppress (and add to the suppression list), requeue (attempts reset), mark not interested, and hand the lead to the team / resume the agent.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!isId(id)) return NextResponse.json({ error: 'Invalid contact id' }, { status: 400 })
  const parsed = Patch.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  const { action, note } = parsed.data
  try {
    const detail = await getContactDetail(id)
    if (!detail) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    const { contact } = detail
    if (action === 'suppress') {
      await addSuppression(contact.phone, { reason: note ?? 'Suppressed by an admin', source: 'admin', actor: admin.label })
    } else if (action === 'requeue') {
      if (contact.opted_out_at || contact.dnd_status === 'dnd') {
        return NextResponse.json({ error: 'This contact opted out or is on DND and cannot be requeued' }, { status: 409 })
      }
      await transition(contact, 'queued', { actor: admin.label, data: { note: note ?? null }, set: { attempts: 0, next_attempt_at: new Date() } })
    } else if (action === 'handoff') {
      await ensureRun(contact)
      await runs.handOff({ contactId: id, reason: note ?? 'Handed off by an admin', channel: 'follow_up', actor: admin.label, now: new Date() })
    } else if (action === 'resume') {
      if (!(await runs.resume(id, admin.label, new Date()))) return NextResponse.json({ error: 'Nothing is handed off for this contact' }, { status: 409 })
    } else {
      await transition(contact, 'not_interested', { actor: admin.label, data: { note: note ?? null } })
    }
    return NextResponse.json((await getContactDetail(id)) ?? detail)
  } catch (e) {
    if (e instanceof InvalidTransitionError) return NextResponse.json({ error: e.message }, { status: 409 })
    if (e instanceof ContactNotFoundError) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    return serverError(e)
  }
}
