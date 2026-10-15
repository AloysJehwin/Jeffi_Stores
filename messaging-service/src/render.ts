// {{var}} / {var} renderer — same token grammar as the monolith's templates/variables-shared.ts.
const TOKEN_RE = /\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}|\{\s*([a-z_][a-z0-9_]*)\s*\}/gi
export type Vars = Record<string, string | number | boolean | null | undefined>

const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function render(input: string, vars: Vars, html = false): string {
  if (!input) return input
  const lower = new Map(Object.entries(vars).filter(([, v]) => v != null).map(([k, v]) => [k.toLowerCase(), String(v)]))
  return input.replace(TOKEN_RE, (m, a: string, b: string) => {
    const v = lower.get((a || b).toLowerCase())
    if (v === undefined) return m
    return html ? esc(v) : v
  })
}

export function tokenKeys(input: string): string[] {
  const out = new Set<string>()
  for (const m of (input || '').matchAll(TOKEN_RE)) out.add((m[1] || m[2]).toLowerCase())
  return [...out]
}

export function missingKeys(input: string, vars: Vars): string[] {
  const have = new Set(Object.keys(vars).map(k => k.toLowerCase()))
  return tokenKeys(input).filter(k => !have.has(k))
}
