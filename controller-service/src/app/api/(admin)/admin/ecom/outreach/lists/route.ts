import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { formFile, readForm } from '@/lib/shared/form-file'
import { IMPORT_MAX_BYTES } from '@/lib/import/file-check'
import { outreachGuard, firstIssue, serverError } from '@controller/lib/outreach/guard'
import { getProgram } from '@controller/lib/outreach/programs/_registry'
import { listLists } from '@controller/lib/outreach/lists'
import { createSheetList, importUpload, ImportError } from '@controller/lib/outreach/import'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const DEFAULT_PROGRAM = 'showcase-offer'

export async function GET(req: NextRequest) {
  const admin = await outreachGuard(req, 'read')
  if (admin instanceof NextResponse) return admin
  const program = req.nextUrl.searchParams.get('program') || DEFAULT_PROGRAM
  if (!getProgram(program)) return NextResponse.json({ error: 'Unknown program' }, { status: 404 })
  try {
    return NextResponse.json({ lists: await listLists(program) })
  } catch (e) {
    return serverError(e)
  }
}

const SheetSchema = z.object({
  program: z.string().default(DEFAULT_PROGRAM),
  name: z.string().trim().min(1).max(120),
  sheetUrl: z.string().trim().min(1).max(500),
  sheetTitle: z.string().trim().max(120).optional(),
})

// POST multipart (file + name [+ program]) → import a CSV/XLSX; POST JSON { name, sheetUrl } → a Sheet-backed list, synced now.
export async function POST(req: NextRequest) {
  const admin = await outreachGuard(req, 'write')
  if (admin instanceof NextResponse) return admin
  try {
    if ((req.headers.get('content-type') || '').includes('multipart/form-data')) {
      const declared = Number(req.headers.get('content-length'))
      if (declared > IMPORT_MAX_BYTES + 64 * 1024) return NextResponse.json({ error: 'File is larger than 15 MB. Split it into smaller files.' }, { status: 413 })
      const form = await readForm(req, 'admin/ecom/outreach/lists')
      const file = formFile(form, 'file', 'admin/ecom/outreach/lists')
      if (!file) return NextResponse.json({ error: 'No file received. Choose a .xlsx or .csv file.' }, { status: 400 })
      const program = String(form?.get('program') || DEFAULT_PROGRAM)
      if (!getProgram(program)) return NextResponse.json({ error: 'Unknown program' }, { status: 404 })
      const name = String(form?.get('name') || file.name || '').trim().slice(0, 120)
      if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 })
      const out = await importUpload({ program, name, fileName: file.name || 'contacts.csv', buf: Buffer.from(await file.arrayBuffer()), actor: admin })
      return NextResponse.json(out, { status: 201 })
    }
    const parsed = SheetSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 })
    if (!getProgram(parsed.data.program)) return NextResponse.json({ error: 'Unknown program' }, { status: 404 })
    return NextResponse.json(await createSheetList({ ...parsed.data, actor: admin }), { status: 201 })
  } catch (e) {
    if (e instanceof ImportError) return NextResponse.json({ error: e.message }, { status: e.status })
    return serverError(e)
  }
}
