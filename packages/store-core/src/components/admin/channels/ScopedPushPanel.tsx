'use client'

import { useEffect, useMemo, useState } from 'react'
import { MultiSelect, type Option } from '@/components/ui/Select'
import { Table, api, btnGhost, btnPrimary, type Col } from '@/components/admin/kit/core'
import { StatusBadge } from '@/components/admin/kit/status'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { countSyncErrorItems, type MerchantSyncError } from '@/lib/merchant/sync-errors'
import type { BrandApproval } from './BrandApprovalsPanel'

type PushChannel = 'gmc' | 'amazon'

export interface ScopedPushResult {
  mode?: 'scoped' | 'full'
  synced?: number
  deleted?: number
  skipped?: number
  errors?: MerchantSyncError[]
  finishedAt?: string
}

interface DryRunRow {
  productId: string
  sku: string
  name: string
  brand: string
  strategy: 'offer-only' | 'create'
  asin: string | null
  listable: boolean | null
  postable: boolean | null
  blockReason?: string
}
interface DryRunReport {
  scanned: number
  offerOnly: number
  create: number
  postable: number
  blocked: number
  rows: DryRunRow[]
  truncated: boolean
}

interface Category {
  id: string
  name: string
  parent_category_id: string | null
}

const NAME: Record<PushChannel, string> = { gmc: 'Google', amazon: 'Amazon' }

/** Category options labelled with their path ("Parent › Child"), parents first. */
function categoryOptions(cats: Category[]): Option<string>[] {
  const byId = new Map(cats.map(c => [c.id, c]))
  const path = (c: Category, seen = new Set<string>()): string => {
    const parent = c.parent_category_id ? byId.get(c.parent_category_id) : null
    if (!parent || seen.has(parent.id)) return c.name
    seen.add(c.id)
    return `${path(parent, seen)} › ${c.name}`
  }
  return cats.map(c => ({ value: c.id, label: path(c) })).sort((a, b) => a.label.localeCompare(b.label))
}

const DRY_COLS: Col<DryRunRow>[] = [
  { key: 'sku', label: 'SKU', sort: r => r.sku, render: r => <span className="font-mono text-xs">{r.sku}</span> },
  { key: 'name', label: 'Product', sort: r => r.name, render: r => <span className="block max-w-xs truncate">{r.name}</span> },
  { key: 'brand', label: 'Brand', sort: r => r.brand, render: r => r.brand || '-' },
  { key: 'match', label: 'Match', render: r => (r.strategy === 'offer-only' ? `Existing ASIN ${r.asin ?? ''}` : 'New listing') },
  {
    key: 'result',
    label: 'Result',
    sort: r => (r.postable ? 2 : r.postable === null ? 1 : 0),
    render: r =>
      r.postable ? (
        <StatusBadge status="ok" map={{ ok: { label: 'Would post', tone: 'green' } }} />
      ) : (
        <span className="inline-flex items-center gap-2">
          <StatusBadge status="no" map={{ no: { label: r.postable === null ? 'Unknown' : 'Blocked', tone: r.postable === null ? 'muted' : 'red' } }} />
          {r.blockReason && <span className="block max-w-xs truncate text-xs text-foreground-secondary">{r.blockReason}</span>}
        </span>
      ),
  },
]

/** Push only some brands or categories to Google / Amazon (Amazon also dry-runs the same selection). */
export default function ScopedPushPanel({
  channel,
  endpoint,
  writeScope,
  dryRun = false,
  running = false,
  onPushed,
  onRunning,
}: {
  channel: PushChannel
  endpoint: string
  writeScope: string
  dryRun?: boolean
  running?: boolean
  onPushed?: (result: ScopedPushResult) => void
  onRunning?: () => void
}) {
  const name = NAME[channel]
  const canWrite = useCanWrite(writeScope)
  const toast = useActionToast()
  const [brands, setBrands] = useState<BrandApproval[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [brandIds, setBrandIds] = useState<string[]>([])
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [busy, setBusy] = useState<'push' | 'dryrun' | null>(null)
  const [result, setResult] = useState<ScopedPushResult | null>(null)
  const [report, setReport] = useState<DryRunReport | null>(null)

  useEffect(() => {
    if (!canWrite) return
    Promise.all([api<{ brands: BrandApproval[] }>(`/api/admin/channels/${channel}/brand-approvals`), api<{ categories: Category[] }>('/api/categories')]).then(([b, c]) => {
      if (b.ok) setBrands(b.data.brands ?? [])
      if (c.ok) setCats(c.data.categories ?? [])
      if (!b.ok || !c.ok) setLoadError(b.data.error || c.data.error || 'Could not load brands and categories')
    })
  }, [channel, canWrite])

  const brandOptions = useMemo<Option<string>[]>(
    () =>
      brands.map(b => ({
        value: b.brandId,
        label: `${b.brandName} (${b.productCount.toLocaleString('en-IN')})`,
        hint: b.allowed ? undefined : `Held back: not approved for ${name}`,
      })),
    [brands, name]
  )
  const catOptions = useMemo(() => categoryOptions(cats), [cats])

  if (!canWrite) return null

  const hasScope = brandIds.length > 0 || categoryIds.length > 0
  const scope = { ...(brandIds.length ? { brandIds } : {}), ...(categoryIds.length ? { categoryIds } : {}) }

  async function push() {
    setBusy('push')
    setReport(null)
    const r = await api<ScopedPushResult & { inProgress?: boolean }>(endpoint, { method: 'POST', json: scope, headers: { 'x-requested-with': 'jeffi-admin' } })
    setBusy(null)
    if (!r.ok) {
      if (r.data.inProgress) {
        onRunning?.()
        toast.warning(r.data.error || 'A sync is already running.')
      } else toast.error(r.data.error || 'Push failed.')
      return
    }
    setResult(r.data)
    onPushed?.(r.data)
    if (r.data.errors?.length) toast.warning(`Push finished with ${countSyncErrorItems(r.data.errors).toLocaleString()} error(s).`)
    else toast.success(`Pushed ${r.data.synced ?? 0} items to ${name}.`)
  }

  async function runDry() {
    setBusy('dryrun')
    setResult(null)
    const r = await api<{ report: DryRunReport }>(endpoint, { method: 'POST', json: { ...scope, mode: 'dryrun' }, headers: { 'x-requested-with': 'jeffi-admin' } })
    setBusy(null)
    if (!r.ok) {
      toast.error(r.data.error || 'Dry run failed.')
      return
    }
    setReport(r.data.report)
    toast.success(`Dry run checked ${r.data.report.scanned} products. Nothing was sent to ${name}.`)
  }

  const errorCount = countSyncErrorItems(result?.errors)
  const notPostable = report?.rows.filter(r => !r.postable) ?? []

  return (
    <div className="rounded-lg border border-border-default p-3 space-y-3">
      <div>
        <p className="text-sm font-medium text-foreground">Push by brand or category</p>
        <p className="text-xs text-foreground-muted">
          Send only the products of the brands or categories you pick. A category includes its sub-categories. To send everything, use the push button above.
        </p>
      </div>
      {loadError && <p className="text-xs text-red-600 dark:text-red-400">{loadError}</p>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="min-w-0">
          <p className="mb-1 text-xs text-foreground-muted">Brands</p>
          <MultiSelect className="w-full" value={brandIds} onChange={setBrandIds} options={brandOptions} placeholder="Any brand" aria-label="Brands" disabled={!!busy} />
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs text-foreground-muted">Categories</p>
          <MultiSelect className="w-full" value={categoryIds} onChange={setCategoryIds} options={catOptions} placeholder="Any category" aria-label="Categories" disabled={!!busy} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btnPrimary} disabled={!hasScope || !!busy || running} onClick={push}>
          {busy === 'push' ? 'Pushing…' : 'Push selected'}
        </button>
        {dryRun && (
          <button type="button" className={btnGhost} disabled={!!busy || running} onClick={runDry}>
            {busy === 'dryrun' ? 'Checking…' : hasScope ? 'Dry run selected' : 'Dry run'}
          </button>
        )}
        {hasScope && (
          <button
            type="button"
            className="text-xs text-foreground-muted hover:text-foreground"
            disabled={!!busy}
            onClick={() => {
              setBrandIds([])
              setCategoryIds([])
            }}
          >
            Clear
          </button>
        )}
        {dryRun && <span className="text-xs text-foreground-muted">A dry run checks up to 100 products and sends nothing.</span>}
      </div>

      {result && (
        <div className="rounded-lg bg-surface-secondary/40 p-3 text-xs text-foreground-secondary space-y-1">
          <p>
            Pushed {(result.synced ?? 0).toLocaleString('en-IN')} item(s) to {name}
            {result.deleted ? `, removed ${result.deleted.toLocaleString('en-IN')}` : ''}.
          </p>
          {!!result.skipped && (
            <p>
              Held back {result.skipped.toLocaleString('en-IN')} product(s) because their brand is not approved for {name}. Change that under Brand approvals.
            </p>
          )}
          {errorCount > 0 && <p className="text-red-600 dark:text-red-400">{errorCount.toLocaleString('en-IN')} error(s), listed above.</p>}
        </div>
      )}

      {report && (
        <div className="space-y-2">
          <p className="text-xs text-foreground-secondary">
            Checked {report.scanned} product(s): {report.offerOnly} match an existing ASIN, {report.create} would be new listings, {report.postable} would post, {report.blocked} blocked.
            {report.truncated ? ` Only the first ${report.scanned} were checked.` : ''}
          </p>
          {notPostable.length > 0 && <Table rows={notPostable} cols={DRY_COLS} rowKey={r => r.sku || r.productId} noun="products" />}
        </div>
      )}
    </div>
  )
}
