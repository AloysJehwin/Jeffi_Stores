'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import { Section, Table, api, btnGhost, inputCls, when, type Col } from '@/components/admin/kit/core'
import { StatusBadge, type StatusMap } from '@/components/admin/kit/status'
import { LoadingLines } from '@/components/admin/kit/skeleton'
import { ErrorState } from '@/components/admin/kit/states'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'

export type BrandChannel = 'gmc' | 'amazon' | 'myntra' | 'ajio' | 'flipkart' | 'meta_ads'
type ApprovalStatus = 'approved' | 'pending' | 'not_approved'

export interface BrandApproval {
  brandId: string
  brandName: string
  productCount: number
  status: ApprovalStatus | null
  allowed: boolean
  source: 'manual' | 'amazon_restrictions' | null
  note: string | null
  approvalUrl: string | null
  checkedAt: string | null
  updatedBy: string | null
  updatedAt: string | null
}

interface Payload {
  channel: BrandChannel
  requiresApproval: boolean
  brands: BrandApproval[]
}

interface CheckResult {
  checked: number
  approved: number
  notApproved: number
  manualKept: number
  noAsin: number
  errors: Array<{ brand: string; error: string }>
}

const WRITE_SCOPE: Record<BrandChannel, string> = {
  gmc: 'merchant_sync:write',
  amazon: 'amazon:write',
  myntra: 'myntra:write',
  ajio: 'ajio:write',
  flipkart: 'flipkart:write',
  meta_ads: 'meta_ads:write',
}

export const BRAND_CHANNEL_NAME: Record<BrandChannel, string> = { gmc: 'Google', amazon: 'Amazon', myntra: 'Myntra', ajio: 'AJIO', flipkart: 'Flipkart', meta_ads: 'the Meta catalogue' }
const SHORT_NAME: Record<BrandChannel, string> = { gmc: 'Google', amazon: 'Amazon', myntra: 'Myntra', ajio: 'AJIO', flipkart: 'Flipkart', meta_ads: 'Meta' }

const STATUS: StatusMap = {
  approved: { label: 'Approved', tone: 'green' },
  pending: { label: 'Pending', tone: 'amber' },
  not_approved: { label: 'Not approved', tone: 'red' },
}

const STATUS_OPTIONS = [
  { value: '', label: 'No decision' },
  { value: 'approved', label: 'Approved' },
  { value: 'pending', label: 'Pending' },
  { value: 'not_approved', label: 'Not approved' },
]

/** Which brands may be pushed to a sales channel, with a per-brand status control. */
export default function BrandApprovalsPanel({ channel }: { channel: BrandChannel }) {
  const name = BRAND_CHANNEL_NAME[channel]
  const short = SHORT_NAME[channel]
  const base = `/api/admin/channels/${channel}/brand-approvals`
  const canWrite = useCanWrite(WRITE_SCOPE[channel])
  const toast = useActionToast()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState<CheckResult | null>(null)

  const load = useCallback(async () => {
    const r = await api<Payload>(base)
    if (r.ok) {
      setData(r.data)
      setError(null)
    } else setError(r.data.error || 'Could not load brands')
  }, [base])

  useEffect(() => {
    load()
  }, [load])

  const requires = !!data?.requiresApproval
  const blockedCount = data?.brands.filter(b => !b.allowed).length ?? 0

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    return (data?.brands ?? []).filter(b => (!blockedOnly || !b.allowed) && (!term || b.brandName.toLowerCase().includes(term)))
  }, [data, q, blockedOnly])

  async function setStatus(b: BrandApproval, value: string) {
    const status = (value || null) as ApprovalStatus | null
    if (status === b.status) return
    setSaving(b.brandId)
    const r = await api(base, { method: 'PUT', json: { brandId: b.brandId, status, note: b.source === 'manual' && b.note ? b.note : undefined } })
    setSaving(null)
    if (!r.ok) {
      toast.error(r.data.error || 'Could not save')
      return
    }
    toast.success(`${b.brandName}: ${status ? STATUS[status].label.toLowerCase() : 'decision cleared'}.`)
    load()
  }

  async function runCheck() {
    setChecking(true)
    const r = await api<CheckResult & { ok: boolean }>(`${base}/check`, { method: 'POST', json: {} })
    setChecking(false)
    if (!r.ok) {
      toast.error(r.data.error || 'Could not check with Amazon')
      return
    }
    setCheck(r.data)
    if (r.data.errors?.length) toast.warning(`Checked ${r.data.checked} brands with ${r.data.errors.length} error(s).`)
    else toast.success(`Checked ${r.data.checked} brands with Amazon.`)
    load()
  }

  const statusBadge = (b: BrandApproval) =>
    b.status ? (
      <StatusBadge status={b.status} map={STATUS} title={b.note} />
    ) : (
      <StatusBadge
        status="none"
        map={{ none: { label: requires ? 'No decision (blocked)' : 'No decision', tone: requires ? 'red' : 'muted' } }}
        title={requires ? `Not pushed to ${name} until approved.` : `Pushed to ${name} unless marked not approved.`}
      />
    )

  const setBy = (b: BrandApproval) =>
    b.source === 'amazon_restrictions' ? (
      <span className="text-xs text-foreground-secondary">Checked with Amazon · {when(b.checkedAt)}</span>
    ) : b.source === 'manual' ? (
      <span className="text-xs text-foreground-secondary">
        By hand{b.updatedBy ? ` · ${b.updatedBy}` : ''} · {when(b.updatedAt)}
      </span>
    ) : (
      <span className="text-xs text-foreground-muted">-</span>
    )

  const cols: Col<BrandApproval>[] = [
    {
      key: 'brand',
      label: 'Brand',
      sort: b => b.brandName.toLowerCase(),
      render: b => (
        <div className="min-w-0 max-w-xs">
          <p className="truncate text-foreground">{b.brandName}</p>
          {b.note && <p className="line-clamp-2 whitespace-normal text-xs text-foreground-muted">{b.note}</p>}
        </div>
      ),
    },
    { key: 'products', label: 'Products', num: true, sort: b => b.productCount, render: b => b.productCount.toLocaleString('en-IN') },
    { key: 'status', label: 'Status', sort: b => (b.allowed ? 1 : 0), render: statusBadge },
    { key: 'set', label: 'Set', render: setBy },
    {
      key: 'action',
      label: '',
      render: b => (
        <div className="flex items-center gap-2">
          {canWrite && (
            <AdminSelect
              xs
              className="w-36"
              value={b.status ?? ''}
              options={STATUS_OPTIONS}
              disabled={saving === b.brandId}
              onChange={v => setStatus(b, v)}
            />
          )}
          {b.approvalUrl && (
            <a href={b.approvalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-accent-600 hover:underline dark:text-accent-400">
              Request approval on {short}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      ),
    },
  ]

  const action =
    channel === 'amazon' && canWrite ? (
      <button type="button" className={btnGhost} disabled={checking} onClick={runCheck}>
        <ShieldCheck className="h-4 w-4" />
        {checking ? 'Checking…' : 'Check with Amazon'}
      </button>
    ) : undefined

  return (
    <Section title="Brand approvals" action={action}>
      <div className="space-y-3">
        <p className="text-xs text-foreground-muted">
          {requires
            ? `${short} needs each brand approved before its products are pushed. Brands with no decision are held back.`
            : `Every brand is pushed to ${name} unless you mark it not approved or pending.`}
          {data ? ` ${blockedCount.toLocaleString('en-IN')} of ${data.brands.length.toLocaleString('en-IN')} brands are held back.` : ''}
        </p>

        {checking && <p className="text-xs text-foreground-muted">Asking Amazon about each brand. This can take a few minutes.</p>}
        {check && !checking && (
          <div className="rounded-lg border border-border-default bg-surface-secondary/40 p-3 text-xs text-foreground-secondary space-y-1">
            <p>
              Checked {check.checked} brand(s) with Amazon: {check.approved} approved, {check.notApproved} need approval.
              {check.manualKept ? ` ${check.manualKept} set by hand were left as they are.` : ''}
              {check.noAsin ? ` ${check.noAsin} have no matched Amazon product to check with.` : ''}
            </p>
            {check.errors?.length > 0 && (
              <details>
                <summary className="cursor-pointer text-red-600 dark:text-red-400">{check.errors.length} brand(s) could not be checked</summary>
                <ul className="mt-1 space-y-0.5">
                  {check.errors.map((e, i) => (
                    <li key={`${e.brand}-${i}`}>
                      <span className="font-medium text-foreground">{e.brand}</span>: {e.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search brands…" className={`${inputCls} w-64 max-w-full`} />
          <label className="inline-flex items-center gap-2 text-sm text-foreground-secondary">
            <input type="checkbox" checked={blockedOnly} onChange={e => setBlockedOnly(e.target.checked)} className="h-4 w-4 rounded border-border-secondary" />
            Blocked only
          </label>
        </div>

        {error ? (
          <ErrorState body={error} />
        ) : !data ? (
          <LoadingLines lines={5} />
        ) : (
          <Table rows={rows} cols={cols} rowKey={b => b.brandId} noun="brands" empty={data.brands.length ? 'No brands match.' : 'No brands yet.'} />
        )}
      </div>
    </Section>
  )
}
