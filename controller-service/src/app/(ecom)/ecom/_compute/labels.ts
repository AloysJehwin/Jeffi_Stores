import { DEDICATED_PRESETS, PRESETS, PRESET_DB_CLASS } from '@/lib/compute/presets'
import type { ComputeSpec } from '@/lib/compute/spec'
import type { QuoteLine } from '@controller/lib/compute/pricing'

// Owner-facing words for compute: the size cards' names for server types and database classes, no AWS product names.
// A custom pick that matches no size keeps its raw name.
const SERVER_SIZE: Record<string, string> = Object.fromEntries(DEDICATED_PRESETS.map(k => [PRESETS[k].spec.node.type, PRESETS[k].label]))
const DB_SIZE: Record<string, string> = Object.fromEntries(DEDICATED_PRESETS.map(k => [PRESET_DB_CLASS[k], PRESETS[k].label]))

export const serverSize = (type: string | null | undefined): string | null => (type && SERVER_SIZE[type]) || null
export const dbSize = (cls: string | null | undefined): string | null => (cls && DB_SIZE[cls]) || null

/** e.g. "Small server · database on the same server". */
export function specSummary(s: ComputeSpec): string {
  const n = s.node.count
  const size = serverSize(s.node.type)
  const server =
    s.node.placement === 'pool'
      ? 'Shared server'
      : `${n > 1 ? `${n} ` : ''}${size ?? 'Custom'} server${n > 1 ? 's' : ''}${size ? '' : ` (${s.node.type})`}`
  const dbName = dbSize(s.db.class)
  const db =
    s.db.mode === 'shared'
      ? 'shared database'
      : s.db.mode === 'node'
        ? 'database on the same server'
        : `separate ${dbName ? `${dbName.toLowerCase()} ` : ''}database, ${s.db.storageGb} GB${s.db.multiAz ? ', with standby' : ''}`
  return `${server} · ${db}`
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// A raw name matches only on its own, so t4g.small never matches inside db.t4g.small.
const NAMES: [RegExp, string][] = [
  ...Object.entries(DB_SIZE).map(([k, v]) => [k, `${v.toLowerCase()} database`] as const),
  ...Object.entries(SERVER_SIZE).map(([k, v]) => [k, `${v.toLowerCase()} server`] as const),
].map(([k, v]): [RegExp, string] => [new RegExp(`(?<![\\w.])${esc(k)}(?![\\w.])`, 'g'), v])

/** A quote line (lib/compute/pricing) in plain words. */
export function plainQuoteLine(l: QuoteLine): { label: string; detail: string } {
  if (l.key === 's3') return { label: 'File storage', detail: l.detail.replace(/ in S3$/, '') }
  if (l.key === 'ipv4') {
    const n = Number(l.detail.split(' ')[0]) || 1
    return { label: n > 1 ? `Public IP addresses (${n})` : 'Public IP address', detail: 'one per server' }
  }
  return { label: l.label, detail: NAMES.reduce((d, [re, name]) => d.replace(re, name), l.detail) }
}
