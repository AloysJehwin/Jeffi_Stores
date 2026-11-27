import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { formFile, readForm } from '@/lib/shared/form-file'
import { IMPORT_MAX_BYTES } from '@/lib/import/file-check'
import { importJobs } from '@controller/lib/outreach/agent/jobs-import'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { ImportError } from '@controller/lib/outreach/import'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const UUID = /^[0-9a-f-]{36}$/i
const Mapping = z.record(z.string(), z.string().trim().min(1).max(200))

// POST multipart { file (csv/xlsx), mapping: JSON { <inputName>: <column header> } } → { created, duplicates, failed: { row, errors }[] }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  const { id } = await params
  if (!UUID.test(id)) return NextResponse.json({ error: 'Invalid agent id' }, { status: 400 })
  try {
    const declared = Number(req.headers.get('content-length'))
    if (declared > IMPORT_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: 'File is larger than 15 MB. Split it into smaller files.' }, { status: 413 })
    const form = await readForm(req, 'admin/ecom/outreach/agents/jobs/import')
    const file = formFile(form, 'file', 'admin/ecom/outreach/agents/jobs/import')
    if (!file) return NextResponse.json({ error: 'No file received. Choose a .xlsx or .csv file.' }, { status: 400 })
    let raw: unknown = null
    try {
      raw = JSON.parse(String(form?.get('mapping') ?? ''))
    } catch {
      /* falls through to the validation error */
    }
    const mapping = Mapping.safeParse(raw)
    if (!mapping.success) return NextResponse.json({ error: raw === null ? 'mapping must be JSON: { "<input>": "<column header>" }' : firstIssue(mapping.error) }, { status: 400 })
    const out = await importJobs({ skillId: id, fileName: file.name || 'jobs.csv', buf: Buffer.from(await file.arrayBuffer()), mapping: mapping.data, actor: admin })
    return NextResponse.json(out, { status: 201 })
  } catch (e) {
    if (e instanceof ImportError) return NextResponse.json({ error: e.message }, { status: e.status })
    return serverError(e)
  }
}
