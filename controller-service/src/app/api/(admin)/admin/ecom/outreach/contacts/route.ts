import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { listContacts } from '@controller/lib/outreach/contacts'
import { CONTACT_STATUSES } from '@controller/lib/outreach/types'

export const dynamic = 'force-dynamic'

const Query = z.object({
  program: z.string().default('showcase-offer'),
  status: z.string().optional(),
  list: z.string().uuid().optional(),
  q: z.string().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

// GET ?program&status=a,b&list&q&page&pageSize → contacts, newest activity first.
export async function GET(req: NextRequest) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const parsed = Query.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
  const { status, list, ...rest } = parsed.data
  const statuses = status ? status.split(',').map(s => s.trim()).filter(Boolean) : []
  const bad = statuses.find(s => !(CONTACT_STATUSES as readonly string[]).includes(s))
  if (bad) return NextResponse.json({ error: `Unknown status: ${bad}` }, { status: 400 })
  try {
    return NextResponse.json(await listContacts({ ...rest, statuses: statuses as (typeof CONTACT_STATUSES)[number][], listId: list }))
  } catch (e) {
    return serverError(e)
  }
}
