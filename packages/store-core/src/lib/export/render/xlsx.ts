import 'server-only'
import { PassThrough } from 'node:stream'
import { XLSX_NUMFMT, isNumeric, xlsxValue } from '../format'
import type { ExportColumn } from '../types'
import { headerLines, makeTotals, totalsLabelKey, truncationNote, toWeb, type ExportDocument, type Rendered, CONTENT_TYPES } from './common'

// Excel via ExcelJS's streaming writer: one sheet per section, the header block highlighted above
// the table, a bold tinted header row frozen under it, typed cells with number formats, a totals row.

const BRAND_FILL = 'FFEEF2FF'
const HEAD_FILL = 'FF1E293B'
const TOTAL_FILL = 'FFF1F5F9'

function sheetName(title: string | undefined, i: number, used: Set<string>): string {
  const base = (title || `Sheet ${i + 1}`).replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 31) || `Sheet ${i + 1}`
  let name = base
  for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`
  used.add(name.toLowerCase())
  return name
}

function widthOf(c: ExportColumn): number {
  if (c.type === 'datetime') return 18
  if (c.type === 'date') return 13
  if (isNumeric(c.type)) return 14
  return Math.min(48, Math.max(12, c.label.length + 4, (c.width ?? 1) * 16))
}

export async function renderXlsx(doc: ExportDocument, run: <T>(fn: () => Promise<T>) => Promise<T>): Promise<Rendered> {
  const ExcelJS = (await import('exceljs')).default
  const out = new PassThrough()
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false })
  wb.creator = doc.generatedBy
  wb.created = doc.generatedAt
  const lines = headerLines(doc)
  const used = new Set<string>()

  const write = async () => {
    for (const [i, s] of doc.sections.entries()) {
      const span = Math.max(2, s.columns.length)
      const sectionTitle = doc.sections.length > 1 && s.title ? 1 : 0
      const above = lines.length ? lines.length + 1 : 0
      const headRow = above + sectionTitle + 1
      const ws = wb.addWorksheet(sheetName(s.title ?? (doc.sections.length === 1 ? doc.title : undefined), i, used), {
        views: [{ state: 'frozen', ySplit: headRow }],
      })
      ws.columns = s.columns.map(c => ({ key: c.key, width: widthOf(c) }))

      for (const l of lines) {
        const row = ws.addRow([l.label, l.value])
        row.getCell(1).font = { bold: true, color: { argb: 'FF334155' } }
        for (let c = 1; c <= span; c++) row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND_FILL } }
        if (span > 2) ws.mergeCells(row.number, 2, row.number, span)
        row.commit()
      }
      if (lines.length) ws.addRow([]).commit()
      if (sectionTitle) {
        const t = ws.addRow([s.title])
        t.getCell(1).font = { bold: true, size: 12 }
        t.commit()
      }

      const head = ws.addRow(s.columns.map(c => c.label))
      head.eachCell(cell => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } }
        cell.alignment = { vertical: 'middle', wrapText: true }
      })
      head.commit()

      const totals = makeTotals(doc, s)
      for await (const batch of s.rows) {
        for (const r of batch) {
          totals.add(r)
          const row = ws.addRow(s.columns.map(c => xlsxValue(r[c.key], c.type)))
          s.columns.forEach((c, ci) => {
            const fmt = c.type && XLSX_NUMFMT[c.type]
            if (fmt) row.getCell(ci + 1).numFmt = fmt
          })
          row.commit()
        }
      }

      const t = totals.result()
      if (t) {
        const labelKey = totalsLabelKey(s.columns, t)
        const row = ws.addRow(s.columns.map(c => (c.key === labelKey ? 'Total' : xlsxValue(t[c.key], c.type))))
        s.columns.forEach((c, ci) => {
          const cell = row.getCell(ci + 1)
          cell.font = { bold: true }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_FILL } }
          cell.border = { top: { style: 'thin', color: { argb: 'FF94A3B8' } } }
          const fmt = c.type && XLSX_NUMFMT[c.type]
          if (fmt) cell.numFmt = fmt
        })
        row.commit()
      }
      if (doc.branding.summary && s.summary?.length) {
        ws.addRow([]).commit()
        for (const m of s.summary) {
          const row = ws.addRow([m.label, xlsxValue(m.value, m.type)])
          row.getCell(1).font = { bold: true }
          const fmt = m.type && XLSX_NUMFMT[m.type]
          if (fmt) row.getCell(2).numFmt = fmt
          row.commit()
        }
      }
      const note = truncationNote(doc)
      if (note && i === doc.sections.length - 1) {
        ws.addRow([]).commit()
        const row = ws.addRow([note])
        row.getCell(1).font = { italic: true, color: { argb: 'FFB45309' } }
        row.commit()
      }
      ws.commit()
    }
    await wb.commit()
  }

  run(write).catch(err => {
    console.error('[export/xlsx]', err)
    out.destroy(err instanceof Error ? err : new Error(String(err)))
  })
  return { body: await toWeb(out), contentType: CONTENT_TYPES.xlsx }
}
