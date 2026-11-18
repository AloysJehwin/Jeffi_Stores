// Global teardown: findings.jsonl → summary.json + summary.md (also printed), then the throwaway drafts are deleted.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { FINDINGS_PATH, MANIFEST_PATH, OUTPUT_DIR, WIDTHS, type Manifest } from './pages'
import type { FindingsLine } from './sweep.spec'

const MAX_ERROR_LINES = 300

export function writeSummary(): string {
  const manifest = fs.existsSync(MANIFEST_PATH) ? (JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8')) as Manifest) : null
  if (!fs.existsSync(FINDINGS_PATH) && !manifest?.skipped?.length) return ''
  const lines = fs.existsSync(FINDINGS_PATH)
    ? fs
        .readFileSync(FINDINGS_PATH, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map(l => JSON.parse(l) as FindingsLine)
    : []
  const archetypes = [...new Set(lines.map(l => l.archetype))]
  const cell = (a: string, w: number) => {
    const ls = lines.filter(l => l.archetype === a && l.width === w)
    if (ls.length === 0) return '–'
    const e = ls.reduce((n, l) => n + l.findings.filter(f => f.severity === 'error').length, 0)
    const wn = ls.reduce((n, l) => n + l.findings.filter(f => f.severity === 'warning').length, 0)
    const sk = ls.filter(l => l.skipped).length
    return `${e}e/${wn}w${sk ? ` (${sk} skipped)` : ''}`
  }
  const widths = WIDTHS.filter(w => lines.some(l => l.width === w))
  const md: string[] = []
  md.push('# Responsive sweep', '', `${lines.length} page renders · ${lines.filter(l => l.findings.some(f => f.severity === 'error')).length} with errors (e = errors, w = warnings)`, '')
  md.push(`| archetype | ${widths.join(' | ')} |`, `|---|${widths.map(() => '---').join('|')}|`)
  for (const a of archetypes) md.push(`| ${a} | ${widths.map(w => cell(a, w)).join(' | ')} |`)
  const byKind: Record<string, number> = {}
  for (const l of lines) for (const f of l.findings) byKind[`${f.kind}:${f.severity}`] = (byKind[`${f.kind}:${f.severity}`] ?? 0) + 1
  md.push('', '## By kind', '', ...Object.entries(byKind).sort().map(([k, n]) => `- ${k}: ${n}`))
  md.push('', '## Errors', '')
  const errs = lines.flatMap(l => l.findings.filter(f => f.severity === 'error').map(f => ({ l, f })))
  if (errs.length === 0) md.push('none')
  // One line per distinct element (repeated cards fold into one): the widths it fails at.
  const grouped = new Map<string, { l: FindingsLine; f: FindingsLine['findings'][number]; widths: number[] }>()
  for (const { l, f } of errs) {
    const el = f.kind === 'clipped-text' ? f.element : f.element.replace(/ "[^"]*"/, '')
    const key = `${l.archetype}|${l.page}|${f.kind}|${f.blockType}|${el}`
    const g = grouped.get(key) ?? { l, f, widths: [] }
    g.widths.push(l.width)
    grouped.set(key, g)
  }
  const groups = [...grouped.values()]
  for (const { l, f, widths: ws } of groups.slice(0, MAX_ERROR_LINES)) {
    const per = [...new Set(ws)].sort((a, b) => a - b)
    const n = Math.round(ws.length / per.length)
    md.push(`- **${l.archetype} / ${l.page}** @${per.join(',')}${n > 1 ? ` ×${n}` : ''} · ${f.kind}${f.blockType ? ` [${f.blockType}]` : ''} · \`${f.element}\` — ${f.detail}`)
  }
  if (groups.length > MAX_ERROR_LINES) md.push(`- … ${groups.length - MAX_ERROR_LINES} more (summary.json)`)
  const skipped = [
    ...(manifest?.skipped ?? []).map(s => `${s.archetype}${s.page ? ` / ${s.page}` : ''}: ${s.reason}`),
    ...lines.filter(l => l.skipped).map(l => `${l.archetype} / ${l.page}: ${l.skipped}`),
  ]
  if (skipped.length) md.push('', '## Skipped', '', ...[...new Set(skipped)].map(s => `- ${s}`))
  const text = md.join('\n') + '\n'
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.md'), text)
  fs.writeFileSync(path.join(OUTPUT_DIR, 'summary.json'), JSON.stringify({ archetypes, widths, byKind, skipped: manifest?.skipped ?? [], lines }, null, 2))
  return text
}

export default async function globalTeardown() {
  try {
    const text = writeSummary()
    if (text) process.stdout.write('\n' + text + '\n')
  } finally {
    execFileSync(path.join('node_modules', '.bin', 'tsx'), ['--tsconfig', 'tests/responsive/tsconfig.sweep.json', 'tests/responsive/cleanup.ts'], { stdio: 'inherit' })
  }
}
