import * as XLSX from 'xlsx'
import { checkImportFile } from '@/lib/import/file-check'
import { FLAGSHIP_TENANT_ID } from '@/lib/payments/wallet'
import { resolveGoogleSheetsCreds } from '@/lib/integrations/resolve'
import { listSheetTitles, readSheetValues, wholeSheetRange } from '@/lib/shared/google-sheets'
import { extractSpreadsheetId } from '@/lib/import/google-sync'
import { outreachPool } from './db'
import { recordEvent } from './events'
import { createList, getList, markSynced } from './lists'
import { normalizePhone } from './phone'
import { suppressedAmong } from './suppress'
import { DND_STATUSES, LANGUAGES, type DndStatus, type OutreachList, type OutreachLanguage } from './types'

export const MAX_ROWS = 5000

export class ImportError extends Error {
  constructor(message: string, public status = 400) {
    super(message)
    this.name = 'ImportError'
  }
}

const REQUIRED = ['business_name', 'phone', 'source'] as const
const KNOWN = new Set(['business_name', 'phone', 'source', 'owner_name', 'category', 'city', 'address', 'language', 'dnd_status', 'notes', 'google_maps_url', 'website'])
const NO_WEBSITE = new Set(['', '-', '--', 'n/a', 'na', 'none', 'no', 'nil', 'null'])

export interface ContactRow {
  phone: string
  business_name: string
  owner_name: string | null
  category: string | null
  city: string | null
  address: string | null
  language: OutreachLanguage | null
  source: string
  dnd_status: DndStatus
  extra: Record<string, unknown>
}

export interface Rejection {
  row: number
  reason: string
  phone?: string
}

export interface ImportSummary {
  total: number
  inserted: number
  updated: number
  rejected: number
  rejections: Rejection[]
}

const cell = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim())
const headerKey = (h: unknown) => cell(h).toLowerCase().replace(/[\s-]+/g, '_')

/** A header row plus data rows to raw row objects keyed by normalised header. Row numbers are 1-based sheet rows. */
export function matrixToRows(matrix: unknown[][]): { rows: { row: number; values: Record<string, string> }[]; fatal?: string } {
  const nonEmpty = matrix.filter(r => r.some(c => cell(c) !== ''))
  if (!nonEmpty.length) return { rows: [], fatal: 'The file is empty.' }
  const headers = matrix[0].map(headerKey)
  const missing = REQUIRED.filter(h => !headers.includes(h))
  if (missing.length) return { rows: [], fatal: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. The first row must be the header row.` }
  const rows: { row: number; values: Record<string, string> }[] = []
  for (let i = 1; i < matrix.length; i++) {
    const raw = matrix[i]
    if (!raw.some(c => cell(c) !== '')) continue
    const values: Record<string, string> = {}
    headers.forEach((h, j) => {
      if (h) values[h] = cell(raw[j])
    })
    rows.push({ row: i + 1, values })
  }
  if (rows.length > MAX_ROWS) return { rows: [], fatal: `Too many rows (${rows.length}). Import at most ${MAX_ROWS} at a time.` }
  return { rows }
}

/** Any header row plus data rows, for importing jobs: no required columns. `values` is keyed by the normalised header (headerKey). */
export function parseTableFile(buf: Buffer, name: string): { headers: string[]; rows: { row: number; values: Record<string, string> }[]; fatal?: string } {
  const bad = checkImportFile(name, buf)
  if (bad) throw new ImportError(bad.error, bad.status)
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'buffer' })
  } catch {
    return { headers: [], rows: [], fatal: 'Could not read the file. Is it a valid .xlsx or .csv?' }
  }
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { headers: [], rows: [], fatal: 'The workbook has no sheets.' }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '', raw: false })
  if (!matrix.length || !matrix[0].some(c => cell(c) !== '')) return { headers: [], rows: [], fatal: 'The file is empty.' }
  const headers = matrix[0].map(headerKey)
  const rows: { row: number; values: Record<string, string> }[] = []
  for (let i = 1; i < matrix.length; i++) {
    if (!matrix[i].some(c => cell(c) !== '')) continue
    const values: Record<string, string> = {}
    headers.forEach((h, j) => {
      if (h) values[h] = cell(matrix[i][j])
    })
    rows.push({ row: i + 1, values })
  }
  if (rows.length > MAX_ROWS) return { headers, rows: [], fatal: `Too many rows (${rows.length}). Import at most ${MAX_ROWS} at a time.` }
  return { headers: headers.filter(Boolean), rows }
}

/** The header key a mapping's column name matches ("Order No." and "order_no." are the same column). */
export const columnKey = headerKey

export function parseContactFile(buf: Buffer, name: string): { rows: { row: number; values: Record<string, string> }[]; fatal?: string } {
  const bad = checkImportFile(name, buf)
  if (bad) throw new ImportError(bad.error, bad.status)
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.read(buf, { type: 'buffer' })
  } catch {
    return { rows: [], fatal: 'Could not read the file. Is it a valid .xlsx or .csv?' }
  }
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return { rows: [], fatal: 'The workbook has no sheets.' }
  return matrixToRows(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '', raw: false }))
}

/** Validates one raw row. `suppressed` holds E.164 numbers already on the suppression list. */
export function validateRow(
  row: number,
  v: Record<string, string>,
  suppressed: Set<string>
): { ok: true; contact: ContactRow } | { ok: false; rejection: Rejection } {
  const rej = (reason: string, phone?: string) => ({ ok: false as const, rejection: { row, reason, ...(phone ? { phone } : {}) } })
  if (!v.business_name) return rej('business_name is required')
  if (!v.source) return rej('source is required (where this lead came from)')
  const phone = normalizePhone(v.phone)
  if (!phone) return rej(`Not a valid Indian mobile number: ${v.phone || '(blank)'}`)
  const website = (v.website ?? '').toLowerCase()
  if (!NO_WEBSITE.has(website)) return rej('Already has a website', phone)
  if (suppressed.has(phone)) return rej('Number is on the suppression list', phone)
  const dndRaw = (v.dnd_status ?? '').toLowerCase()
  const dnd = (DND_STATUSES as readonly string[]).includes(dndRaw) ? (dndRaw as DndStatus) : 'unknown'
  if (dnd === 'dnd') return rej('Number is registered on DND', phone)
  const lang = (v.language ?? '').toLowerCase()
  const extra: Record<string, unknown> = {}
  for (const [k, val] of Object.entries(v)) if (val && !KNOWN.has(k)) extra[k] = val
  if (v.notes) extra.notes = v.notes
  if (v.google_maps_url) extra.google_maps_url = v.google_maps_url
  return {
    ok: true,
    contact: {
      phone,
      business_name: v.business_name,
      owner_name: v.owner_name || null,
      category: v.category || null,
      city: v.city || null,
      address: v.address || null,
      language: (LANGUAGES as readonly string[]).includes(lang) ? (lang as OutreachLanguage) : null,
      source: v.source,
      dnd_status: dnd,
      extra,
    },
  }
}

/** Validates every row (duplicates inside the file count once) and upserts the good ones on (program, phone). */
export async function importRows(
  listId: string,
  program: string,
  raw: { row: number; values: Record<string, string> }[],
  actor: string
): Promise<ImportSummary> {
  const e164 = raw.map(r => normalizePhone(r.values.phone)).filter((p): p is string => !!p)
  const suppressed = await suppressedAmong(e164)
  const rejections: Rejection[] = []
  const good: ContactRow[] = []
  const seen = new Set<string>()
  for (const r of raw) {
    const out = validateRow(r.row, r.values, suppressed)
    if (!out.ok) {
      rejections.push(out.rejection)
      continue
    }
    if (seen.has(out.contact.phone)) {
      rejections.push({ row: r.row, reason: 'Duplicate of an earlier row in this file', phone: out.contact.phone })
      continue
    }
    seen.add(out.contact.phone)
    good.push(out.contact)
  }

  let inserted = 0
  let updated = 0
  const client = await outreachPool().connect()
  try {
    await client.query('BEGIN')
    for (const c of good) {
      // Descriptive fields refresh; status and progress stay for anyone already past `new`.
      const r = await client.query(
        `INSERT INTO outreach_contacts (list_id, program, phone, business_name, owner_name, category, city, address, language, source, extra, dnd_status, status, next_attempt_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'queued',now())
         ON CONFLICT (program, phone) DO UPDATE SET
           list_id = EXCLUDED.list_id,
           business_name = EXCLUDED.business_name,
           owner_name = COALESCE(EXCLUDED.owner_name, outreach_contacts.owner_name),
           category = COALESCE(EXCLUDED.category, outreach_contacts.category),
           city = COALESCE(EXCLUDED.city, outreach_contacts.city),
           address = COALESCE(EXCLUDED.address, outreach_contacts.address),
           language = COALESCE(EXCLUDED.language, outreach_contacts.language),
           extra = outreach_contacts.extra || EXCLUDED.extra,
           status = CASE WHEN outreach_contacts.status = 'new' THEN 'queued' ELSE outreach_contacts.status END,
           next_attempt_at = CASE WHEN outreach_contacts.status = 'new' THEN now() ELSE outreach_contacts.next_attempt_at END,
           updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [listId, program, c.phone, c.business_name, c.owner_name, c.category, c.city, c.address, c.language, c.source, JSON.stringify(c.extra), c.dnd_status]
      )
      if (r.rows[0]?.inserted) inserted++
      else updated++
    }
    await recordEvent(null, 'list_imported', { actor, data: { listId, program, total: raw.length, inserted, updated, rejected: rejections.length } }, client)
    await markSynced(listId, inserted + updated, client)
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return { total: raw.length, inserted, updated, rejected: rejections.length, rejections }
}

export async function importUpload(opts: { program: string; name: string; fileName: string; buf: Buffer; actor: { id: string | null; label: string } }): Promise<{ list: OutreachList; summary: ImportSummary }> {
  const parsed = parseContactFile(opts.buf, opts.fileName)
  if (parsed.fatal) throw new ImportError(parsed.fatal)
  const list = await createList({ program: opts.program, name: opts.name, source: 'upload', createdBy: opts.actor.id })
  const summary = await importRows(list.id, opts.program, parsed.rows, opts.actor.label)
  return { list: (await getList(list.id)) ?? list, summary }
}

function sheetFailure(e: unknown): ImportError {
  const msg = e instanceof Error ? e.message : String(e)
  return new ImportError(`Could not read the Google Sheet: ${msg}`, 502)
}

/** Reads the list's Sheet with the flagship's Google Sheets connection and upserts its rows. */
export async function syncSheetList(listId: string, actor: { id: string | null; label: string }): Promise<{ list: OutreachList; summary: ImportSummary }> {
  const list = await getList(listId)
  if (!list) throw new ImportError('List not found', 404)
  if (list.source !== 'google_sheet' || !list.spreadsheet_id) throw new ImportError('Only Google Sheet lists can be synced', 400)
  let matrix: string[][]
  try {
    const { accessToken } = await resolveGoogleSheetsCreds(FLAGSHIP_TENANT_ID)
    const title = list.sheet_title || (await listSheetTitles(list.spreadsheet_id, accessToken))[0]
    if (!title) throw new Error('The spreadsheet has no tabs')
    matrix = await readSheetValues(list.spreadsheet_id, wholeSheetRange(title), accessToken)
  } catch (e) {
    throw sheetFailure(e)
  }
  const parsed = matrixToRows(matrix)
  if (parsed.fatal) throw new ImportError(parsed.fatal)
  const summary = await importRows(list.id, list.program, parsed.rows, actor.label)
  return { list: (await getList(list.id)) ?? list, summary }
}

export async function createSheetList(opts: { program: string; name: string; sheetUrl: string; sheetTitle?: string | null; actor: { id: string | null; label: string } }): Promise<{ list: OutreachList; summary: ImportSummary }> {
  const spreadsheetId = extractSpreadsheetId(opts.sheetUrl)
  if (!spreadsheetId) throw new ImportError('That does not look like a Google Sheets link or id.')
  const list = await createList({ program: opts.program, name: opts.name, source: 'google_sheet', spreadsheetId, sheetTitle: opts.sheetTitle ?? null, createdBy: opts.actor.id })
  return syncSheetList(list.id, opts.actor)
}
