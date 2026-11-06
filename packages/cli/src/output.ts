// Human output: tables for lists, key/value for records. --json prints the raw data instead.

type Row = Record<string, unknown>

const PREFERRED = ['id', 'name', 'display_name', 'slug', 'sku', 'order_number', 'email', 'title', 'status', 'state', 'plan', 'created_at', 'createdAt']
const MAX_CELL = 48

const isScalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v)

export function cell(v: unknown, max = MAX_CELL): string {
  let s: string
  if (v === null || v === undefined) s = ''
  else if (typeof v === 'object') s = JSON.stringify(v)
  else s = String(v)
  s = s.replace(/\s+/g, ' ')
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

export function pickColumns(rows: Row[], limit = 7): string[] {
  const keys: string[] = []
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k)
  const scalar = keys.filter(k => rows.some(r => r[k] !== undefined && r[k] !== null && isScalar(r[k])))
  const ordered = [...PREFERRED.filter(k => scalar.includes(k)), ...scalar.filter(k => !PREFERRED.includes(k))]
  return (ordered.length ? ordered : keys).slice(0, limit)
}

export function renderTable(rows: Row[], columns = pickColumns(rows)): string {
  if (!rows.length) return '(no rows)'
  const head = columns.map(c => c.toUpperCase())
  const body = rows.map(r => columns.map(c => cell(r[c])))
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(b => b[i].length)))
  const line = (cells: string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i]))).join('  ').trimEnd()
  return [line(head), ...body.map(line)].join('\n')
}

export function renderRecord(obj: Row): string {
  const keys = Object.keys(obj)
  const w = Math.min(28, Math.max(0, ...keys.map(k => k.length)))
  return keys
    .map(k => {
      const v = obj[k]
      const shown = Array.isArray(v) && v.length && v.every(x => typeof x === 'object' && x) ? `[${v.length} items]` : cell(v, 100)
      return `${k.padEnd(w)}  ${shown}`
    })
    .join('\n')
}

const isRowArray = (v: unknown): v is Row[] => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'object' && x !== null && !Array.isArray(x))

/** A sensible rendering of an API answer. */
export function format(data: unknown): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return isRowArray(data) ? renderTable(data) : data.length ? data.map(x => cell(x, 200)).join('\n') : '(no rows)'
  if (data && typeof data === 'object') {
    const obj = data as Row
    const lists = Object.entries(obj).filter(([, v]) => isRowArray(v))
    const scalars = Object.fromEntries(Object.entries(obj).filter(([, v]) => !isRowArray(v)))
    if (lists.length === 1) {
      const head = Object.keys(scalars).length ? renderRecord(scalars) + '\n\n' : ''
      return head + renderTable(lists[0][1] as Row[])
    }
    return renderRecord(obj)
  }
  return String(data)
}

export function parseCsv(text: string): Row[] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  const [head, ...rest] = rows.filter(r => r.some(x => x !== ''))
  if (!head) return []
  const keys = head.map(h => h.replace(/^\uFEFF/, ''))
  return rest.map(r => Object.fromEntries(keys.map((k, i) => [k, r[i] ?? ''])))
}
