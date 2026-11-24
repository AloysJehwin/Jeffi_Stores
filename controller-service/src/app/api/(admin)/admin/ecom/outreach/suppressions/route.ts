import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { addSuppression, listSuppressions, removeSuppression } from '@controller/lib/outreach/suppress'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const sp = req.nextUrl.searchParams
  try {
    return NextResponse.json(await listSuppressions({ q: sp.get('q') ?? undefined, page: Number(sp.get('page')) || 1, pageSize: Number(sp.get('pageSize')) || 50 }))
  } catch (e) {
    return serverError(e)
  }
}

const Add = z.object({ phone: z.string().trim().min(1).max(20), reason: z.string().trim().max(200).optional() })

// POST { phone, reason } → suppress a number now; live contacts on it move to `suppressed`.
export async function POST(req: NextRequest) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const parsed = Add.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  try {
    const out = await addSuppression(parsed.data.phone, { reason: parsed.data.reason ?? null, source: 'admin', actor: admin.label })
    if (!out) return NextResponse.json({ error: 'Not a valid Indian mobile number' }, { status: 400 })
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    return serverError(e)
  }
}

const Del = z.object({ phone: z.string().trim().min(1).max(20) })

// DELETE ?phone= (or { phone }) → lift the suppression. Contacts already suppressed stay so until requeued.
export async function DELETE(req: NextRequest) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const body = req.nextUrl.searchParams.get('phone') ? { phone: req.nextUrl.searchParams.get('phone') } : await req.json().catch(() => null)
  const parsed = Del.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  try {
    if (!(await removeSuppression(parsed.data.phone, admin.label))) return NextResponse.json({ error: 'Number is not on the suppression list' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return serverError(e)
  }
}
