import { NextRequest, NextResponse } from 'next/server'
import type { AdminJWTPayload } from '@/lib/auth/jwt'
import { actorOf, channelError } from '@/lib/channels/route'
import { ADS_MARKET, AD_FIELDS, type AdMapping, type AdsChannel } from './columns'
import { MADS_TABS, loadMadsTab, type MadsTab } from './console'
import { MAX_BYTES, ReportError, commitImport, previewImport, type ImportInput } from './import'

// Shared handlers behind /api/admin/{myntra-ads,ajio-ads}/{console,import}. The route files do the
// scope and plan gate.

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function adsConsoleGet(request: NextRequest, channel: AdsChannel) {
  const sp = request.nextUrl.searchParams
  const tab = (sp.get('tab') ?? 'overview') as MadsTab
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  if (!MADS_TABS.includes(tab)) return NextResponse.json({ error: 'Unknown tab' }, { status: 400 })
  if (tab !== 'imports' && (!DATE.test(from) || !DATE.test(to) || from > to)) return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
  try {
    return NextResponse.json({ data: await loadMadsTab(channel, tab, { from, to }) })
  } catch (e) {
    return channelError(e)
  }
}

function parseMapping(raw: FormDataEntryValue | null): AdMapping | null {
  if (typeof raw !== 'string' || !raw) return null
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object') return null
    const out: AdMapping = {}
    for (const f of AD_FIELDS) if (typeof obj[f.key] === 'string' && obj[f.key]) out[f.key] = String(obj[f.key]).slice(0, 300)
    return out
  } catch {
    return null
  }
}

/** POST ?step=preview|commit, multipart: file, mapping (JSON), from, to, allowErrors. */
export async function adsImportPost(request: NextRequest, channel: AdsChannel, admin: AdminJWTPayload) {
  const step = request.nextUrl.searchParams.get('step') ?? 'preview'
  if (step !== 'preview' && step !== 'commit') return NextResponse.json({ error: 'Unknown step' }, { status: 400 })
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !file || typeof file === 'string') return NextResponse.json({ error: 'Choose a report file.' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The file is larger than 10 MB. Download a shorter date range.' }, { status: 400 })
  const str = (k: string) => {
    const v = form.get(k)
    return typeof v === 'string' && v ? v : null
  }
  const input: ImportInput = {
    market: ADS_MARKET[channel],
    buf: Buffer.from(await file.arrayBuffer()),
    fileName: (file as File).name || 'report',
    mapping: parseMapping(form.get('mapping')),
    period: { from: str('from'), to: str('to') },
  }
  try {
    if (step === 'preview') return NextResponse.json({ data: await previewImport(input) })
    const out = await commitImport({ ...input, allowErrors: str('allowErrors') === 'true' }, actorOf(admin))
    return NextResponse.json(out, { status: out.ok ? 200 : 400 })
  } catch (e) {
    if (e instanceof ReportError) return NextResponse.json({ error: e.message }, { status: 400 })
    return channelError(e)
  }
}
