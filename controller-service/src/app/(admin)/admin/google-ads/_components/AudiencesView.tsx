'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Target } from 'lucide-react'
import IconButton from '@/components/ui/IconButton'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { count, humanize } from '@/lib/google-ads/format'
import type { AudiencesData, AudienceView } from '@/lib/google-ads/audiences/refresh'
import { useAdsManage } from './ManageContext'
import { Section } from './ReportViews'
import { Modal, btnGhost, btnPrimary, inputCls } from './wizard/fields'
import Select from '@/components/ui/Select'
import { useActionToast } from '@/components/admin/kit/toast'

// Audiences tab: Customer Match lists built from the store's own customers.

const PARAM: Record<string, { key: 'days' | 'minOrders' | 'topPercent'; label: string } | null> = {
  repeat_buyers: { key: 'minOrders', label: 'Min. paid orders' },
  lapsed: { key: 'days', label: 'No order in (days)' },
  high_value: { key: 'topPercent', label: 'Top % by spend' },
  recent_buyers: { key: 'days', label: 'Ordered within (days)' },
  b2b: null,
}

async function post(body: unknown): Promise<{ ok: boolean; data: any }> {
  const r = await fetch('/api/admin/google-ads/audiences', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}

const matchText = (a: AudienceView) =>
  a.matchRate != null ? `${a.matchRate}%` : a.matchRateRange ? humanize(a.matchRateRange.replace('MATCH_RATE_RANGE_', '')).replace(/ to /, '-') : '-'

export default function AudiencesView({ d: initial }: { d: AudiencesData }) {
  const canWrite = useCanWrite('google_ads')
  const manage = useAdsManage()
  const [d, setD] = useState<AudiencesData>(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useActionToast()
  const setMsg = useCallback((b: { ok: boolean; text: string } | null) => b && toast.result(b), [toast])
  const [attach, setAttach] = useState<AudienceView | null>(null)
  const [agree, setAgree] = useState(false)
  useEffect(() => setD(initial), [initial])

  async function run(key: string, body: unknown, done?: (data: any) => string) {
    setBusy(key)
    setMsg(null)
    const { ok, data } = await post(body)
    setBusy(null)
    if (data?.data?.audiences) setD(data.data)
    if (!ok) setMsg({ ok: false, text: data.error || 'Request failed' })
    else if (done) setMsg({ ok: true, text: done(data) })
  }

  const audiences = d.audiences ?? []
  const anyOn = audiences.some(a => a.enabled)

  return (
    <div className="space-y-5">
      <Section
        title="Customer Match audiences"
        action={
          canWrite && d.termsAcceptedAt ? (
            <IconButton
              icon={RefreshCw}
              label="Refresh lists now"
              busy={busy === 'refresh'}
              onClick={() =>
                run('refresh', { op: 'refresh' }, data => {
                  const r = data.run
                  if (r?.status === 'nothing_enabled') return 'Turn on at least one list first.'
                  const done = (r?.segments ?? []).map((s: any) => `${s.segment.replace(/_/g, ' ')}: +${s.added} / -${s.removed}`).join(', ')
                  return `Refresh ${r?.status}${done ? `: ${done}` : ''}${r?.error ? ` (${r.error})` : ''}`
                })
              }
            />
          ) : undefined
        }
      >
        <div className="text-xs text-foreground-muted space-y-1 mb-4">
          <p>
            Lists are rebuilt from your orders every day and only the changes are sent to Google (hashed email and phone, through
            Google&apos;s Data Manager API). Only customers whose most recent order accepted advertising cookies are included: the store
            has no account-level ad consent, so the latest order&apos;s choice is used. Guests and customers who opted out of marketing are never
            uploaded.
          </p>
          <p>
            Google shows a list only once it has at least {d.minActiveMembers} active matched members (it used to be 1,000 on Search) and recommends
            uploading 5,000 or more. Sizes read 0 until then. Customer Match needs a good policy and payment history; targeting a list also needs 90
            days of Google Ads history and more than USD 50,000 lifetime spend, otherwise lists work for observation and exclusion only.
            Memberships expire after {d.membershipDays} days.
          </p>
        </div>

        {!d.termsAcceptedAt && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm space-y-2 mb-4">
            <p>Before uploading, confirm the store may share customer data with Google under the Customer Match policy.</p>
            {canWrite ? (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
                  I accept Google&apos;s Customer Match terms and my privacy policy discloses sharing with service providers
                </label>
                <button type="button" className={btnPrimary} disabled={!agree || busy === 'terms'} onClick={() => run('terms', { op: 'terms', accept: true })}>
                  Accept
                </button>
              </div>
            ) : (
              <p className="text-foreground-muted">An admin with Google Ads write access can accept them.</p>
            )}
          </div>
        )}


        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-xs text-foreground-muted text-left">
                <th className="py-2 px-2 font-medium">List</th>
                <th className="py-2 px-2 font-medium">On</th>
                <th className="py-2 px-2 font-medium text-right">In segment</th>
                <th className="py-2 px-2 font-medium text-right">Uploaded</th>
                <th className="py-2 px-2 font-medium text-right">Google size (Search / Display)</th>
                <th className="py-2 px-2 font-medium text-right">Match rate</th>
                <th className="py-2 px-2 font-medium">Last refresh</th>
                <th className="py-2 px-2" />
              </tr>
            </thead>
            <tbody>
              {audiences.map(a => (
                <AudienceRow
                  key={a.segment}
                  a={a}
                  canWrite={canWrite}
                  canAttach={!!manage && !!a.userList}
                  min={d.minActiveMembers}
                  busy={busy}
                  onSave={(enabled, params) => run(`s:${a.segment}`, { op: 'settings', segment: a.segment, enabled, params }, () => (enabled ? 'Saved. Refresh to upload.' : 'Saved.'))}
                  onAttach={() => setAttach(a)}
                />
              ))}
            </tbody>
          </table>
        </div>
        {!anyOn && <p className="text-xs text-foreground-muted mt-2">No list is on yet.</p>}
      </Section>
      {attach && <AttachDialog a={attach} campaigns={d.campaigns ?? []} onClose={() => setAttach(null)} />}
    </div>
  )
}

function AudienceRow({
  a,
  canWrite,
  canAttach,
  min,
  busy,
  onSave,
  onAttach,
}: {
  a: AudienceView
  canWrite: boolean
  canAttach: boolean
  min: number
  busy: string | null
  onSave: (enabled: boolean, params: Record<string, number>) => void
  onAttach: () => void
}) {
  const p = PARAM[a.segment]
  const [value, setValue] = useState(p ? String(a.params[p.key] ?? '') : '')
  const small = a.userList && (a.sizeForSearch ?? 0) < min && (a.sizeForDisplay ?? 0) < min
  const params = p && value.trim() !== '' && Number.isFinite(Number(value)) ? { [p.key]: Number(value) } : {}
  return (
    <tr className="border-b border-border-default/60 last:border-0 align-top">
      <td className="py-2 px-2 max-w-sm">
        <p className="font-medium">{a.label}</p>
        <p className="text-xs text-foreground-muted">{a.description}</p>
        <p className="text-xs text-foreground-muted">{a.use}</p>
        {p && canWrite && (
          <label className="text-xs text-foreground-muted flex items-center gap-2 mt-1">
            {p.label}
            <input className={`${inputCls} w-24 py-1`} type="number" value={value} onChange={e => setValue(e.target.value)} />
          </label>
        )}
        {!a.available && <p className="text-xs text-foreground-muted mt-1">No approved business accounts yet.</p>}
        {small && <p className="text-xs text-amber-600 mt-1">Below Google&apos;s {min}-member minimum: not serving yet.</p>}
        {a.lastError && <p className="text-xs text-red-500 mt-1">{a.lastError}</p>}
      </td>
      <td className="py-2 px-2">
        <input
          type="checkbox"
          aria-label={`Turn ${a.label} on`}
          checked={a.enabled}
          disabled={!canWrite || busy === `s:${a.segment}` || (!a.available && !a.enabled)}
          onChange={e => onSave(e.target.checked, params)}
        />
        {canWrite && p && String(a.params[p.key] ?? '') !== value && (
          <button type="button" className="block text-xs text-accent-500 mt-1" onClick={() => onSave(a.enabled, params)}>
            Save
          </button>
        )}
      </td>
      <td className="py-2 px-2 text-right tabular-nums">{count(a.inSegment)}</td>
      <td className="py-2 px-2 text-right tabular-nums">{count(a.members)}</td>
      <td className="py-2 px-2 text-right tabular-nums">
        {a.userList ? `${count(a.sizeForSearch)} / ${count(a.sizeForDisplay)}` : '-'}
        {a.eligibleForSearch === false && <p className="text-[11px] text-foreground-muted">not eligible on Search</p>}
      </td>
      <td className="py-2 px-2 text-right">{matchText(a)}</td>
      <td className="py-2 px-2 text-xs text-foreground-muted whitespace-nowrap">
        {a.lastRefreshAt ? new Date(a.lastRefreshAt).toLocaleString('en-IN') : 'Never'}
        {a.lastRefreshStatus && <p>{humanize(a.lastRefreshStatus)}{a.lastRefreshStatus === 'success' ? ` (+${a.added} / -${a.removed})` : ''}</p>}
      </td>
      <td className="py-2 px-2">{canAttach && <IconButton icon={Target} label="Use in a campaign" onClick={onAttach} />}</td>
    </tr>
  )
}

const MODES: Record<string, { value: string; label: string; hint: string }[]> = {
  search: [
    { value: 'observation', label: 'Observation', hint: 'Ads still show to everyone; you see how this list performs and can bid on it.' },
    { value: 'targeting', label: 'Targeting', hint: 'Ads show only to people on this list. Needs full Customer Match access.' },
    { value: 'exclusion', label: 'Exclusion', hint: 'Never show ads to people on this list (e.g. recent buyers).' },
  ],
  pmax: [{ value: 'signal', label: 'Audience signal', hint: 'Tells Google who converts; Performance Max still finds new customers.' }],
}

function AttachDialog({ a, campaigns, onClose }: { a: AudienceView; campaigns: AudiencesData['campaigns']; onClose: () => void }) {
  const m = useAdsManage()
  const [campaignId, setCampaignId] = useState(campaigns[0]?.campaignId ?? '')
  const campaign = campaigns.find(c => c.campaignId === campaignId)
  const pmax = campaign?.channelType === 'PERFORMANCE_MAX'
  const modes = pmax ? MODES.pmax : MODES.search
  const [mode, setMode] = useState(a.segment === 'recent_buyers' ? 'exclusion' : 'observation')
  const [groups, setGroups] = useState<{ assetGroupId: string; name: string }[] | null>(null)
  const [assetGroupId, setAssetGroupId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const effectiveMode = modes.some(x => x.value === mode) ? mode : modes[0].value

  useEffect(() => {
    if (!pmax || !campaignId) return
    setGroups(null)
    fetch(`/api/admin/google-ads/audiences?assetGroups=${campaignId}`, { credentials: 'include' })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Could not load asset groups')
        setGroups(j.assetGroups ?? [])
        setAssetGroupId(j.assetGroups?.[0]?.assetGroupId ?? '')
      })
      .catch(e => setError(e.message))
  }, [pmax, campaignId])

  async function apply() {
    if (!m) return
    setBusy(true)
    const ok = await m.run(
      { action: 'audience.attach', segment: a.segment, campaignId, mode: effectiveMode, ...(pmax ? { assetGroupId } : {}) },
      `aud:${a.segment}`
    )
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title={`Use "${a.label}" in a campaign`}
      onClose={onClose}
      footer={
        <>
          {error && <span className="text-xs text-red-500 mr-auto">{error}</span>}
          <button type="button" className={btnGhost} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnPrimary} disabled={busy || !campaignId || (pmax && !assetGroupId)} onClick={apply}>
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Add to campaign
          </button>
        </>
      }
    >
      {campaigns.length === 0 ? (
        <p className="text-sm text-foreground-muted">No Search, Shopping or Performance Max campaigns. Sync Google Ads first.</p>
      ) : (
        <>
          <label className="text-sm block space-y-1">
            <span className="text-foreground-muted text-xs">Campaign</span>
            <Select
              className="w-full"
              value={campaignId}
              onChange={setCampaignId}
              options={campaigns.map(c => ({ value: c.campaignId, label: `${c.name} (${humanize(c.channelType)})` }))}
              aria-label="Campaign"
            />
          </label>
          {pmax && (
            <label className="text-sm block space-y-1">
              <span className="text-foreground-muted text-xs">Asset group</span>
              {groups == null ? (
                <p className="text-xs text-foreground-muted">Loading...</p>
              ) : (
                <Select
                  className="w-full"
                  value={assetGroupId}
                  onChange={setAssetGroupId}
                  options={groups.map(g => ({ value: g.assetGroupId, label: g.name }))}
                  aria-label="Asset group"
                />
              )}
            </label>
          )}
          <fieldset className="space-y-2">
            {modes.map(x => (
              <label key={x.value} className="flex items-start gap-2 text-sm">
                <input type="radio" name="mode" checked={effectiveMode === x.value} onChange={() => setMode(x.value)} className="mt-1" />
                <span>
                  <span className="font-medium">{x.label}</span>
                  <span className="block text-xs text-foreground-muted">{x.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-foreground-muted">Google checks the change first; it is logged under Change history.</p>
        </>
      )}
    </Modal>
  )
}
