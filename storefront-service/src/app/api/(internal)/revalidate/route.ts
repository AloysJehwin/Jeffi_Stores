import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { verifyCronRequest } from '@/lib/shared/cron-auth'

export const dynamic = 'force-dynamic'

const Body = z.object({ paths: z.array(z.string().startsWith('/').max(200)).min(1).max(10) })

// POST — the admin app drops pages from this app's cache after a change it can't revalidate itself
// (homepage publish). Reaches one pod; the others refresh within the page's revalidate window.
export async function POST(request: NextRequest) {
  if (!verifyCronRequest(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = Body.safeParse(await request.json().catch(() => null))
  if (!body.success) return NextResponse.json({ error: 'paths required' }, { status: 400 })
  for (const p of body.data.paths) revalidatePath(p)
  return NextResponse.json({ revalidated: body.data.paths })
}
