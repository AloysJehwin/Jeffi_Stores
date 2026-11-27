import 'server-only'
import { csvText, neutralise } from '../format'
import { headerLines, makeTotals, totalsLabelKey, truncationNote, type ExportDocument, type Rendered, CONTENT_TYPES } from './common'

// CSV: BOM, the optional header block as "Label,Value" lines, then each section's table (a title
// line between sections), its totals row and summary lines. Streamed batch by batch.

const BOM = '﻿'

function cell(s: string): string {
  const v = neutralise(s)
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
const line = (cells: string[]) => `${cells.map(cell).join(',')}\r\n`

export function renderCsv(doc: ExportDocument): Rendered {
  const enc = new TextEncoder()
  const multi = doc.sections.length > 1
  async function* chunks(): AsyncGenerator<string> {
    let head = BOM
    const lines = headerLines(doc)
    for (const l of lines) head += line([l.label, l.value])
    if (lines.length) head += '\r\n'
    yield head
    for (const [i, s] of doc.sections.entries()) {
      let out = i > 0 ? '\r\n' : ''
      if (multi && s.title) out += line([s.title])
      out += line(s.columns.map(c => c.label))
      yield out
      const totals = makeTotals(doc, s)
      for await (const batch of s.rows) {
        let buf = ''
        for (const r of batch) {
          totals.add(r)
          buf += line(s.columns.map(c => csvText(r[c.key], c.type)))
        }
        if (buf) yield buf
      }
      let tail = ''
      const t = totals.result()
      if (t) {
        const labelKey = totalsLabelKey(s.columns, t)
        tail += line(s.columns.map(c => (c.key === labelKey ? 'Total' : csvText(t[c.key], c.type))))
      }
      if (doc.branding.summary && s.summary?.length) {
        tail += '\r\n'
        for (const m of s.summary) tail += line([m.label, csvText(m.value, m.type)])
      }
      if (tail) yield tail
    }
    const note = truncationNote(doc)
    if (note) yield `\r\n${line([note])}`
  }
  const it = chunks()
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const { value, done } = await it.next()
        if (done) c.close()
        else c.enqueue(enc.encode(value))
      } catch (err) {
        c.error(err)
      }
    },
    async cancel() {
      await it.return(undefined)
    },
  })
  return { body, contentType: CONTENT_TYPES.csv }
}
