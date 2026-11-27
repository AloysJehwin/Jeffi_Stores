import { NextRequest, NextResponse } from 'next/server'
import { requireAdminScope } from '@/lib/auth/jwt'
import { getExport } from '@/lib/export/registry'
import { ExportError, countExport, exportSchema, runExport } from '@/lib/export/pipeline'
import { deletePreset, savePreset } from '@/lib/export/presets'
import { sanitizeOptions, EXPORT_FORMATS, type ExportRequestBody } from '@/lib/export/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// The standard Export: GET the page's export schema (columns, filters, presets), POST to count or
// run an export (streamed), PUT to save a named preset, DELETE ?id= to remove one. Every method
// is held to the export's own read scope; rows come from the request's tenant DB.

type Params = { params: Promise<{ key: string }> }

async function load(request: NextRequest, { params }: Params) {
  const def = getExport((await params).key)
  if (!def) return { error: NextResponse.json({ error: 'Unknown export' }, { status: 404 }) }
  const admin = await requireAdminScope(request, def.exportScope ?? def.scope)
  if (admin instanceof NextResponse) return { error: admin }
  return { def, admin }
}

const fail = (err: unknown, key: string) => {
  if (err instanceof ExportError) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error(`[export/${key}]`, err)
  return NextResponse.json({ error: 'Export failed' }, { status: 500 })
}

export async function GET(request: NextRequest, ctx: Params) {
  const r = await load(request, ctx)
  if (r.error) return r.error
  try {
    const query = new URLSearchParams(request.nextUrl.searchParams.get('q') ?? '')
    return NextResponse.json(await exportSchema(r.def, r.admin, query), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return fail(err, r.def.key)
  }
}

export async function POST(request: NextRequest, ctx: Params) {
  const r = await load(request, ctx)
  if (r.error) return r.error
  const body = (await request.json().catch(() => null)) as ExportRequestBody | null
  if (!body || typeof body !== 'object' || !body.options) return NextResponse.json({ error: 'Invalid export request' }, { status: 400 })
  try {
    if (body.action === 'count') {
      const count = await countExport(r.def, r.admin, body)
      return NextResponse.json({ count }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const out = await runExport(r.def, r.admin, body, request)
    return new Response(out.body, {
      headers: {
        'Content-Type': out.contentType,
        'Content-Disposition': `attachment; filename="${out.filename}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    return fail(err, r.def.key)
  }
}

export async function PUT(request: NextRequest, ctx: Params) {
  const r = await load(request, ctx)
  if (r.error) return r.error
  const body = (await request.json().catch(() => null)) as { name?: unknown; options?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name the preset' }, { status: 400 })
  try {
    const schema = await exportSchema(r.def, r.admin, new URLSearchParams())
    const options = sanitizeOptions({ ...schema, formats: schema.formats.length ? schema.formats : [...EXPORT_FORMATS] }, body?.options as never)
    const preset = await savePreset(r.admin.adminId, r.def.key, name, options)
    if (!preset) return NextResponse.json({ error: 'Too many presets on this page; delete one first' }, { status: 409 })
    return NextResponse.json({ preset })
  } catch (err) {
    return fail(err, r.def.key)
  }
}

export async function DELETE(request: NextRequest, ctx: Params) {
  const r = await load(request, ctx)
  if (r.error) return r.error
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid preset' }, { status: 400 })
  try {
    const ok = await deletePreset(r.admin.adminId, r.def.key, id)
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Preset not found' }, { status: 404 })
  } catch (err) {
    return fail(err, r.def.key)
  }
}
