'use client'

import { useEffect, useState } from 'react'
import { Ban, Check, Coins, ListPlus, Loader2, Pause, Play, Plus, Target, Trash2, Wallet, X } from 'lucide-react'
import RowActions, { type RowAction } from '@/components/admin/RowActions'
import { usePrompt } from '@/contexts/ConfirmContext'
import { useCanUseAi } from '@/contexts/AdminScopesContext'
import { extensionProblems } from '@/lib/google-ads/campaign-spec'
import { humanize } from '@/lib/google-ads/format'
import { useAdsManage, type AdsManage } from './ManageContext'
import ExtensionsEditor, { SuggestionsLoading, toExtensions, useAssetSuggestions } from './wizard/ExtensionsEditor'
import { Modal, btnGhost, btnPrimary } from './wizard/fields'

// Row actions for the console tables. Rendered only for admins with google_ads_campaigns:write;
// destructive ones confirm first, and every change is validated with Google before it is made.

/** An actions column for a report table, present only for admins who can manage campaigns. */
export function actionsCol<T>(on: boolean, render: (r: T) => React.ReactNode) {
  return on ? [{ key: 'actions', label: '', render }] : []
}

const toggle = (status: string | null | undefined) => (status === 'ENABLED' ? 'PAUSED' : 'ENABLED')
const toggleLabel = (status: string | null | undefined, what: string) => (status === 'ENABLED' ? `Pause ${what}` : `Enable ${what}`)

function parseAmount(v: string | null): number | null {
  if (v == null) return null
  const n = Number(v.replace(/[₹,%\s]/g, ''))
  return Number.isFinite(n) && n > 0 ? n : NaN
}

function statusAction(m: AdsManage, key: string, status: string | null | undefined, what: string, body: Record<string, unknown>): RowAction {
  return {
    key: 'status',
    icon: status === 'ENABLED' ? Pause : Play,
    label: toggleLabel(status, what),
    busy: m.busyKey === `${key}:status`,
    hidden: status !== 'ENABLED' && status !== 'PAUSED',
    onSelect: async () => {
      await m.run({ ...body, status: toggle(status) } as any, `${key}:status`)
    },
  }
}

function removeAction(m: AdsManage, key: string, what: string, name: string, body: Record<string, unknown>): RowAction {
  return {
    key: 'remove',
    icon: Trash2,
    label: `Remove ${what}`,
    danger: true,
    busy: m.busyKey === `${key}:remove`,
    confirm: {
      title: `Remove ${what}`,
      message: `Remove ${what} "${name}" in Google Ads? Removed items cannot be enabled again.`,
      confirmLabel: 'Remove',
      variant: 'danger',
    },
    onSelect: async () => {
      await m.run(body as any, `${key}:remove`)
    },
  }
}

export interface CampaignRowLike {
  campaignId: string
  name: string
  status: string | null
  budget: number | null
  biddingStrategy: string | null
  channelType: string | null
}

const TARGET_STRATEGIES = new Set(['MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE', 'TARGET_CPA', 'TARGET_ROAS'])

export function CampaignRowActions({ row }: { row: CampaignRowLike }) {
  const m = useAdsManage()
  const prompt = usePrompt()
  const [assets, setAssets] = useState(false)
  if (!m) return null
  const key = `c:${row.campaignId}`

  async function budget() {
    const v = await prompt({
      title: 'Daily budget',
      message: `New daily budget for "${row.name}" (${m!.currency})`,
      defaultValue: row.budget == null ? '' : String(row.budget),
      confirmLabel: 'Change budget',
    })
    const amount = parseAmount(v)
    if (amount == null) return
    if (Number.isNaN(amount)) return m!.notify(false, 'Enter a budget above zero')
    await m!.run({ action: 'campaign.budget', campaignId: row.campaignId, dailyBudget: amount }, `${key}:budget`)
  }

  async function target() {
    const r = await fetch(`/api/admin/google-ads/manage/campaigns/${row.campaignId}`, { credentials: 'include' })
    const s = await r.json().catch(() => ({}))
    if (!r.ok) return m!.notify(false, s.error || 'Could not read the campaign')
    if (s.portfolio) return m!.notify(false, 'This campaign uses a shared bid strategy. Change its targets in Google Ads.')
    const roas = s.biddingStrategyType === 'MAXIMIZE_CONVERSION_VALUE' || s.biddingStrategyType === 'TARGET_ROAS'
    const v = await prompt({
      title: roas ? 'Target ROAS' : 'Target CPA',
      message: roas
        ? `Target ROAS for "${row.name}" in percent (400 = ₹4 of sales per ₹1). Leave empty to remove the target.`
        : `Target cost per conversion for "${row.name}" (${m!.currency}). Leave empty to remove the target.`,
      defaultValue: roas ? (s.targetRoas ? String(Math.round(s.targetRoas * 100)) : '') : s.targetCpa ? String(s.targetCpa) : '',
      confirmLabel: 'Save target',
    })
    if (v == null) return
    const amount = v.trim() === '' ? null : parseAmount(v)
    if (amount != null && Number.isNaN(amount)) return m!.notify(false, 'Enter a number above zero')
    await m!.run(
      { action: 'campaign.bidding', campaignId: row.campaignId, ...(roas ? { targetRoas: amount == null ? null : amount / 100 } : { targetCpa: amount }) },
      `${key}:target`
    )
  }

  return (
    <>
      <RowActions
        actions={[
          statusAction(m, key, row.status, 'campaign', { action: 'campaign.status', campaignId: row.campaignId }),
          { key: 'budget', icon: Wallet, label: 'Change budget', busy: m.busyKey === `${key}:budget`, hidden: row.budget == null, onSelect: budget },
          {
            key: 'target',
            icon: Target,
            label: 'Change bid target',
            busy: m.busyKey === `${key}:target`,
            hidden: !TARGET_STRATEGIES.has(row.biddingStrategy ?? ''),
            onSelect: target,
          },
          { key: 'assets', icon: ListPlus, label: 'Add assets', onSelect: () => setAssets(true) },
          removeAction(m, key, 'campaign', row.name, { action: 'campaign.remove', campaignId: row.campaignId }),
        ]}
      />
      {assets && <AssetsDialog campaignId={row.campaignId} name={row.name} onClose={() => setAssets(false)} />}
    </>
  )
}

export function AdGroupRowActions({ row }: { row: { adGroupId: string; name: string; status: string | null; cpcBid: number | null } }) {
  const m = useAdsManage()
  const prompt = usePrompt()
  if (!m) return null
  const key = `g:${row.adGroupId}`
  async function bid() {
    const v = await prompt({
      title: 'Max CPC',
      message: `Default max cost per click for "${row.name}" (${m!.currency}). Used with manual bidding.`,
      defaultValue: row.cpcBid == null ? '' : String(row.cpcBid),
      confirmLabel: 'Set max CPC',
    })
    const amount = parseAmount(v)
    if (amount == null) return
    if (Number.isNaN(amount)) return m!.notify(false, 'Enter a bid above zero')
    await m!.run({ action: 'adgroup.bid', adGroupId: row.adGroupId, cpcBid: amount }, `${key}:bid`)
  }
  return (
    <RowActions
      actions={[
        statusAction(m, key, row.status, 'ad group', { action: 'adgroup.status', adGroupId: row.adGroupId }),
        { key: 'bid', icon: Coins, label: 'Set max CPC', busy: m.busyKey === `${key}:bid`, onSelect: bid },
        removeAction(m, key, 'ad group', row.name, { action: 'adgroup.remove', adGroupId: row.adGroupId }),
      ]}
    />
  )
}

export function AdRowActions({ row }: { row: { adId: string; adGroupId?: string; name: string | null; type: string | null; status: string | null } }) {
  const m = useAdsManage()
  if (!m || !row.adGroupId) return null
  const key = `a:${row.adGroupId}:${row.adId}`
  const ref = { adGroupId: row.adGroupId, adId: row.adId }
  return (
    <RowActions
      actions={[
        statusAction(m, key, row.status, 'ad', { action: 'ad.status', ...ref }),
        removeAction(m, key, 'ad', row.name || humanize(row.type), { action: 'ad.remove', ...ref }),
      ]}
    />
  )
}

export function KeywordRowActions({ row }: { row: { criterionId: string; adGroupId?: string; text: string; status: string | null; negative: boolean } }) {
  const m = useAdsManage()
  if (!m || !row.adGroupId) return null
  const key = `k:${row.adGroupId}:${row.criterionId}`
  const ref = { adGroupId: row.adGroupId, criterionId: row.criterionId }
  return (
    <RowActions
      actions={[
        { ...statusAction(m, key, row.status, 'keyword', { action: 'keyword.status', ...ref }), hidden: row.negative || (row.status !== 'ENABLED' && row.status !== 'PAUSED') },
        removeAction(m, key, row.negative ? 'negative keyword' : 'keyword', row.text, { action: 'keyword.remove', ...ref }),
      ]}
    />
  )
}

export function SearchTermRowActions({
  row,
}: {
  row: { term: string; campaignId?: string | null; adGroupId?: string | null; campaignChannel?: string | null; status?: string | null }
}) {
  const m = useAdsManage()
  if (!m) return null
  const key = `t:${row.term}`
  const canKeyword = row.campaignChannel === 'SEARCH' && !!row.adGroupId && row.adGroupId !== '0' && row.status !== 'ADDED'
  return (
    <RowActions
      actions={[
        {
          key: 'keyword',
          icon: Plus,
          label: 'Add as exact keyword',
          hidden: !canKeyword,
          busy: m.busyKey === `${key}:kw`,
          confirm: { title: 'Add keyword', message: `Add "${row.term}" as an exact match keyword to the ad group it came from?`, confirmLabel: 'Add keyword' },
          onSelect: async () => {
            await m.run({ action: 'keyword.add', adGroupId: row.adGroupId, text: row.term, matchType: 'EXACT' }, `${key}:kw`)
          },
        },
        {
          key: 'negative',
          icon: Ban,
          label: 'Add as negative keyword',
          hidden: !row.campaignId || row.status === 'EXCLUDED',
          busy: m.busyKey === `${key}:neg`,
          confirm: {
            title: 'Add negative keyword',
            message: `Stop showing ads for "${row.term}" in this campaign (exact match negative)?`,
            confirmLabel: 'Add negative',
          },
          onSelect: async () => {
            await m.run({ action: 'negative.add', level: 'campaign', campaignId: row.campaignId, text: row.term, matchType: 'EXACT' }, `${key}:neg`)
          },
        },
      ]}
    />
  )
}

export function RecommendationRowActions({ row }: { row: { id: string; type: string | null } }) {
  const m = useAdsManage()
  if (!m) return null
  const key = `r:${row.id}`
  return (
    <RowActions
      actions={[
        {
          key: 'apply',
          icon: Check,
          label: 'Apply recommendation',
          busy: m.busyKey === `${key}:apply`,
          confirm: { title: 'Apply recommendation', message: `Apply "${humanize(row.type)}" in Google Ads now?`, confirmLabel: 'Apply' },
          onSelect: async () => {
            await m.run({ action: 'recommendation.apply', resourceName: row.id }, `${key}:apply`)
          },
        },
        {
          key: 'dismiss',
          icon: X,
          label: 'Dismiss recommendation',
          busy: m.busyKey === `${key}:dismiss`,
          confirm: { title: 'Dismiss recommendation', message: `Dismiss "${humanize(row.type)}"? Google stops suggesting it.`, confirmLabel: 'Dismiss' },
          onSelect: async () => {
            await m.run({ action: 'recommendation.dismiss', resourceName: row.id }, `${key}:dismiss`)
          },
        },
      ]}
    />
  )
}

export function AssetsDialog({ campaignId, name, onClose }: { campaignId: string; name: string; onClose: () => void }) {
  const m = useAdsManage()
  const canAi = useCanUseAi('google_ads_campaigns')
  const { draft, setDraft, error } = useAssetSuggestions()
  const [busy, setBusy] = useState(false)
  const ext = draft ? toExtensions(draft) : null
  const problems = ext ? extensionProblems(ext) : []
  const total = ext ? ext.sitelinks.length + ext.callouts.length + ext.promotions.length + ext.prices.length + ext.snippets.length : 0

  async function add() {
    if (!m || !ext) return
    setBusy(true)
    const ok = await m.run({ action: 'assets.add', campaignId, extensions: ext }, `c:${campaignId}:assets`)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title={`Add assets to "${name}"`}
      onClose={onClose}
      wide
      footer={
        <>
          {problems.length > 0 && <span className="text-xs text-red-500 mr-auto">{problems[0]}</span>}
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !total || problems.length > 0} onClick={add}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Add {total || ''} asset{total === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      {draft ? <ExtensionsEditor draft={draft} onChange={setDraft} canAi={canAi} /> : <SuggestionsLoading error={error} />}
    </Modal>
  )
}

interface ChangeRow {
  id: string
  created_at: string
  admin_email: string | null
  action: string
  summary: string
  status: 'applied' | 'failed' | 'rejected'
  error: string | null
}

const STATUS_TONE: Record<ChangeRow['status'], string> = {
  applied: 'bg-green-500/10 text-green-700 dark:text-green-400',
  rejected: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

/** Changes made from this console, newest first. */
export function ChangeLogPanel() {
  const [rows, setRows] = useState<ChangeRow[] | null>(null)
  useEffect(() => {
    fetch('/api/admin/google-ads/manage/change-log', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : { changes: [] }))
      .then(d => setRows(d.changes ?? []))
      .catch(() => setRows([]))
  }, [])
  return (
    <div className="bg-surface-elevated border border-border-default rounded-xl p-5">
      <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide mb-4">Changes made here</h2>
      {rows === null ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-foreground-muted text-center py-6">No changes made from this console yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-xs text-foreground-muted text-left">
                <th className="py-2 px-2 font-medium">When</th>
                <th className="py-2 px-2 font-medium">What</th>
                <th className="py-2 px-2 font-medium">Result</th>
                <th className="py-2 px-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="border-b border-border-default/60 last:border-0 align-top">
                  <td className="py-2 px-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString('en-IN')}</td>
                  <td className="py-2 px-2">
                    {r.summary}
                    {r.error && <p className="text-xs text-red-600 dark:text-red-400 whitespace-pre-line mt-1">{r.error}</p>}
                  </td>
                  <td className="py-2 px-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[r.status] ?? ''}`}>{humanize(r.status)}</span>
                  </td>
                  <td className="py-2 px-2 text-xs text-foreground-muted">{r.admin_email || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
