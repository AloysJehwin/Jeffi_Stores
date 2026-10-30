import { NextRequest, NextResponse } from 'next/server'
import { EXPORT_CAP, normalizeQuery } from '@jeffi/list-filters'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getEntity } from '@/lib/filters/registry'
import { cappedCount, filterContext, streamCsv } from '@/lib/filters/run'
import { logAdminAudit } from '@/lib/shared/admin-audit'
import { withDefaultWindow } from '@/lib/filters/window'

export const dynamic = 'force-dynamic'

// CSV of exactly the rows a list's filters match, up to the entity's cap. ?count=1 only counts
// them (the Export button's "Export N rows"); both carry X-Row-Count and X-Row-Capped.
export async function GET(request: NextRequest, { params }: { params: Promise<{ entity: string }> }) {
  const entity = getEntity((await params).entity)
  if (!entity?.export) return NextResponse.json({ error: 'Unknown list' }, { status: 404 })
  const admin = await requireAdminScope(request, entity.exportScope ?? entity.scope)
  if (admin instanceof NextResponse) return admin

  const sp = request.nextUrl.searchParams
  // The same default window the list shows (e.g. the stock ledger's last 30 days).
  const q = withDefaultWindow(entity, normalizeQuery(entity, sp))
  const cap = entity.export.cap ?? EXPORT_CAP
  try {
    const ctx = await filterContext(entity, q)
    const { count, capped } = await cappedCount(entity, q, cap, ctx)
    const headers = { 'X-Row-Count': String(count), 'X-Row-Capped': String(capped), 'Cache-Control': 'no-store' }
    if (sp.get('count') === '1') return NextResponse.json({ count, capped, cap }, { headers })

    const query = new URLSearchParams(q).toString()
    const stream = await streamCsv(entity, q, {
      cap,
      ctx,
      onDone: (rows, completed) =>
        logAdminAudit({
          adminId: admin.adminId,
          action: 'export',
          entityType: entity.key,
          summary: `Exported ${rows.toLocaleString('en-IN')} ${entity.noun.toLowerCase()} to CSV${completed ? '' : ' (cancelled)'}`,
          metadata: { query, rows, capped, completed },
          request,
        }),
    })
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    return new Response(stream, {
      headers: {
        ...headers,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${entity.key}-${day}.csv"`,
      },
    })
  } catch (err) {
    console.error(`[filters/${entity.key}/export]`, err)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}
