export class CliError extends Error {
  constructor(message: string, readonly exitCode = 1, readonly data?: unknown) {
    super(message)
  }
}

declare const __JEFFI_CLI_VERSION__: string | undefined
export const CLI_VERSION = typeof __JEFFI_CLI_VERSION__ === 'string' ? __JEFFI_CLI_VERSION__ : '0.0.0-dev'

export const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s.]+/g, '-')
    .toLowerCase()

/** `k=v` → value parsed as JSON when it is JSON (numbers, true/false, null, [..], {..}), else the string. */
export function parseValue(v: string): unknown {
  const t = v.trim()
  if (t === '') return ''
  if (/^(true|false|null|-?\d+(\.\d+)?([eE][+-]?\d+)?)$/.test(t) || /^[[{"]/.test(t)) {
    try {
      return JSON.parse(t)
    } catch {
      return v
    }
  }
  return v
}

export function splitPair(pair: string, what: string): [string, string] {
  const i = pair.indexOf('=')
  if (i <= 0) throw new CliError(`${what} must look like key=value: ${pair}`)
  return [pair.slice(0, i), pair.slice(i + 1)]
}

/** Sets a dotted key (`a.b.c`) on an object. */
export function setPath(obj: Record<string, unknown>, key: string, value: unknown) {
  const parts = key.split('.')
  let cur = obj
  for (const p of parts.slice(0, -1)) {
    if (typeof cur[p] !== 'object' || cur[p] === null || Array.isArray(cur[p])) cur[p] = {}
    cur = cur[p] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

export const collect = (v: string, prev: string[] = []) => [...prev, v]
