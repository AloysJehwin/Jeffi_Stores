'use client'

import { useMemo, useState } from 'react'
import { useActionToast } from '@/components/admin/kit/toast'
import { FlaskConical, Loader2, RefreshCw } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import DatePicker from '@/components/ui/DatePicker'
import IconButton from '@/components/ui/IconButton'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { STRATEGIES_FOR, type BidStrategy, type CampaignType } from '@/lib/google-ads/campaign-spec'
import { experimentProblems, isSignificant, type ExperimentAction, type ExperimentSpec, type MetricResult } from '@/lib/google-ads/experiment-spec'
import type { ExperimentView } from '@/lib/google-ads/experiments-read'
import { money } from '@/lib/google-ads/format'
import { Empty, Section } from './ReportViews'
import { errorText, postJson } from './ManageContext'
import { Field, btnGhost, btnPrimary, inputCls } from './wizard/fields'

// Campaign experiments: a trial copy of a Search or Display campaign with another bid strategy or
// target on a share of its traffic, results per arm as Google reports them, and end / promote /
// graduate. Creating and acting needs google_ads_campaigns:write (Pro and up).

interface CampaignOption {
  campaignId: string
  name: string
  channelType: string | null
  biddingStrategy: string | null
  status: string | null
}

interface Data {
  experiments: ExperimentView[]
  campaigns: CampaignOption[]
}

const STRATEGY_LABEL: Record<BidStrategy, string> = {
  MAXIMIZE_CONVERSIONS: 'Maximise conversions',
  MAXIMIZE_CONVERSION_VALUE: 'Maximise conversion value',
  MANUAL_CPC: 'Manual CPC',
  MAXIMIZE_CLICKS: 'Maximise clicks',
}

const humanize = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : '-')
const fmt = (v: number | null, m: MetricResult, currency: string) =>
  v == null ? '-' : m.money ? money(v, currency) : v.toLocaleString('en-IN', { maximumFractionDigits: 2 })

export default function ExperimentsView({ d, currency }: { d: Data; currency: string }) {
  const canManage = useCanWrite('google_ads_campaigns')
  const [data, setData] = useState<Data>({ experiments: d?.experiments ?? [], campaigns: d?.campaigns ?? [] })
  const [busy, setBusy] = useState<string | null>(null)
  const toastN = useActionToast()
  const setNotice = (r: { ok: boolean; text: string } | null) => r && toastN.result(r)

  async function refresh() {
    setBusy('refresh')
    const r = await fetch('/api/admin/google-ads/manage/experiments', { credentials: 'include' })
    const body = await r.json().catch(() => ({}))
    setBusy(null)
    if (!r.ok) return setNotice({ ok: false, text: body.error || 'Could not read experiments from Google Ads' })
    setData(body)
  }

  async function act(e: ExperimentView, action: ExperimentAction, dailyBudget?: number) {
    setBusy(`${e.experimentId}:${action}`)
    setNotice(null)
    const { ok, data: res } = await postJson(`/api/admin/google-ads/manage/experiments/${e.experimentId}`, { action, dailyBudget })
    setBusy(null)
    setNotice({ ok, text: ok ? res.summary : errorText(res) })
    if (ok) await refresh()
  }

  return (
    <div className="space-y-5">
      <Section
        title={`Experiments (${data.experiments.length})`}
        action={<IconButton icon={RefreshCw} label="Refresh from Google Ads" busy={busy === 'refresh'} onClick={refresh} />}
      >
        {!data.experiments.length ? (
          <Empty msg="No experiments yet. A trial runs another bid strategy on part of a campaign's traffic and compares the two." />
        ) : (
          <div className="space-y-4">
            {data.experiments.map(e => (
              <ExperimentCard key={e.experimentId} e={e} currency={currency} canManage={canManage} busy={busy} onAction={act} />
            ))}
          </div>
        )}
      </Section>
      {canManage ? (
        <NewExperiment campaigns={data.campaigns} onCreated={refresh} />
      ) : (
        <p className="text-sm text-foreground-muted">Creating and running experiments is part of Google Ads campaign management on the Pro plan.</p>
      )}
    </div>
  )
}

function ExperimentCard({
  e,
  currency,
  canManage,
  busy,
  onAction,
}: {
  e: ExperimentView
  currency: string
  canManage: boolean
  busy: string | null
  onAction: (e: ExperimentView, a: ExperimentAction, budget?: number) => void
}) {
  const [confirm, setConfirm] = useState<ExperimentAction | null>(null)
  const [budget, setBudget] = useState('')
  const live = e.status === 'ENABLED' || e.status === 'INITIATED'
  const done = e.status === 'PROMOTED' || e.status === 'GRADUATED' || e.status === 'HALTED'
  const CONFIRM: Record<ExperimentAction, string> = {
    end: 'End the experiment? The trial stops serving; the base campaign carries on unchanged.',
    promote: "Promote the trial? Google copies its changes into the base campaign and stops the trial.",
    graduate: 'Graduate the trial? It becomes its own campaign with the daily budget below; the base campaign is not changed.',
  }
  return (
    <div className="rounded-xl border border-border-default p-4 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-foreground flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-accent-600" /> {e.name}
          </p>
          <p className="text-xs text-foreground-muted mt-0.5">
            {humanize(e.status)}
            {e.promoteStatus && e.promoteStatus !== 'UNSPECIFIED' ? ` · promotion ${humanize(e.promoteStatus).toLowerCase()}` : ''} · {e.baseCampaignName || `campaign ${e.baseCampaignId ?? '-'}`}
            {e.trafficSplit != null ? ` · trial gets ${e.trafficSplit}% of traffic` : ''}
            {e.startDate ? ` · ${e.startDate}` : ''}
            {e.endDate ? ` to ${e.endDate}` : ''}
          </p>
          {e.change && (
            <p className="text-xs text-foreground-secondary mt-0.5">
              Trial: {STRATEGY_LABEL[e.change.strategy] ?? e.change.strategy}
              {e.change.targetCpa ? `, target CPA ${money(e.change.targetCpa, currency)}` : ''}
              {e.change.targetRoas ? `, target ROAS ${Math.round(e.change.targetRoas * 100)}%` : ''}
            </p>
          )}
        </div>
        {canManage && live && !confirm && (
          <div className="flex gap-2">
            {(['promote', 'graduate', 'end'] as const).map(a => (
              <button key={a} type="button" className={btnGhost} disabled={!!busy} onClick={() => setConfirm(a)}>
                {humanize(a)}
              </button>
            ))}
          </div>
        )}
      </div>
      {confirm && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm space-y-2">
          <p>{CONFIRM[confirm]}</p>
          {confirm === 'graduate' && (
            <Field label="Daily budget for the graduated campaign">
              <input className={`${inputCls} max-w-xs`} inputMode="decimal" value={budget} onChange={ev => setBudget(ev.target.value)} />
            </Field>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={!!busy || (confirm === 'graduate' && !(Number(budget) >= 1))}
              onClick={() => {
                onAction(e, confirm, confirm === 'graduate' ? Number(budget) : undefined)
                setConfirm(null)
              }}
            >
              {busy?.startsWith(e.experimentId) && <Loader2 className="w-4 h-4 animate-spin" />} {humanize(confirm)}
            </button>
            <button type="button" className={btnGhost} onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {e.asyncErrors.length > 0 && (
        <ul className="text-xs text-red-600 dark:text-red-400 list-disc pl-5">
          {e.asyncErrors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {e.results.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground-muted">
                <th className="py-1 pr-3">Metric</th>
                <th className="py-1 pr-3 text-right">Base</th>
                <th className="py-1 pr-3 text-right">Trial</th>
                <th className="py-1 pr-3 text-right">Difference (Google estimate)</th>
                <th className="py-1 text-right">Significance</th>
              </tr>
            </thead>
            <tbody>
              {e.results.map(m => (
                <tr key={m.key} className="border-t border-border-default/60">
                  <td className="py-1 pr-3">{m.label}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmt(m.control, m, currency)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">{fmt(m.treatment, m, currency)}</td>
                  <td className="py-1 pr-3 text-right tabular-nums">
                    {m.estimate == null ? '-' : `${m.estimate > 0 ? '+' : ''}${fmt(m.estimate, m, currency)}${m.margin != null ? ` ± ${fmt(m.margin, m, currency)}` : ''}`}
                  </td>
                  <td className="py-1 text-right text-xs">
                    {m.pValue == null ? '-' : isSignificant(m) ? <span className="text-green-700 dark:text-green-400 font-medium">Significant (p {m.pValue.toFixed(3)})</span> : `Not yet (p ${m.pValue.toFixed(3)})`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        !done && <p className="text-xs text-foreground-muted">Results show once the trial has traffic. Refresh to read the latest from Google.</p>
      )}
    </div>
  )
}

function NewExperiment({ campaigns, onCreated }: { campaigns: CampaignOption[]; onCreated: () => void }) {
  const [campaignId, setCampaignId] = useState('')
  const [name, setName] = useState('')
  const [split, setSplit] = useState('50')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [strategy, setStrategy] = useState<BidStrategy>('MAXIMIZE_CONVERSIONS')
  const [target, setTarget] = useState('')
  const [busy, setBusy] = useState<'preview' | 'create' | null>(null)
  const toast = useActionToast()
  const setResult = (r: { ok: boolean; text: string } | null) => r && toast.result(r)
  const today = new Date().toISOString().slice(0, 10)
  const base = campaigns.find(c => c.campaignId === campaignId)
  const strategies = base ? STRATEGIES_FOR[(base.channelType ?? 'SEARCH') as CampaignType] ?? [] : []

  const spec: ExperimentSpec = useMemo(() => {
    const t = Number(target)
    return {
      campaignId,
      name: name.trim(),
      trafficSplit: Math.round(Number(split)) || 50,
      startDate: startDate || null,
      endDate: endDate || null,
      change: {
        strategy,
        targetCpa: strategy === 'MAXIMIZE_CONVERSIONS' && t > 0 ? t : null,
        targetRoas: strategy === 'MAXIMIZE_CONVERSION_VALUE' && t > 0 ? t / 100 : null,
      },
    }
  }, [campaignId, name, split, startDate, endDate, strategy, target])
  const problems = useMemo(() => {
    if (!campaignId) return ['Pick a campaign']
    const out = experimentProblems(spec, base ? { channelType: base.channelType, biddingStrategyType: base.biddingStrategy, targetCpa: null, targetRoas: null } : null)
    if (!spec.name) out.push('Name the experiment')
    if (spec.trafficSplit < 1 || spec.trafficSplit > 99) out.push('The trial share must be 1 to 99%')
    return out
  }, [spec, base, campaignId])

  async function send(preview: boolean) {
    setBusy(preview ? 'preview' : 'create')
    setResult(null)
    const { ok, data } = await postJson('/api/admin/google-ads/manage/experiments', { spec, preview })
    setBusy(null)
    if (!ok) return setResult({ ok: false, text: errorText(data, 'Google Ads rejected the experiment') })
    setResult({ ok: true, text: preview ? 'Google accepted the experiment (nothing created yet).' : 'Experiment created and scheduled. It starts serving on its start date.' })
    if (!preview) onCreated()
  }

  return (
    <Section title="New experiment">
      <div className="space-y-3">
        <p className="text-xs text-foreground-muted">
          The trial is a copy of the campaign with another bid strategy or target, on a share of its traffic and budget. Budgets
          cannot differ between the arms (they share the campaign&apos;s budget); graduating a trial gives it its own.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <AdminSelect
            label="Campaign (Search or Display)"
            value={campaignId}
            placeholder="Pick a campaign"
            options={campaigns.map(c => ({ value: c.campaignId, label: `${c.name} (${humanize(c.channelType)}, ${humanize(c.biddingStrategy)})` }))}
            onChange={v => {
              setCampaignId(v)
              const c = campaigns.find(x => x.campaignId === v)
              const list = STRATEGIES_FOR[(c?.channelType ?? 'SEARCH') as CampaignType] ?? []
              if (!list.includes(strategy)) setStrategy(list[0] ?? 'MAXIMIZE_CONVERSIONS')
            }}
          />
          <Field label="Experiment name">
            <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. tROAS 400% test" />
          </Field>
          <AdminSelect
            label="Trial bid strategy"
            value={strategy}
            options={(strategies.length ? strategies : (['MAXIMIZE_CONVERSIONS'] as BidStrategy[])).map(s => ({ value: s, label: STRATEGY_LABEL[s] }))}
            onChange={v => setStrategy(v as BidStrategy)}
          />
          {(strategy === 'MAXIMIZE_CONVERSIONS' || strategy === 'MAXIMIZE_CONVERSION_VALUE') && (
            <Field label={strategy === 'MAXIMIZE_CONVERSIONS' ? 'Target CPA (optional)' : 'Target ROAS % (optional)'}>
              <input className={inputCls} inputMode="decimal" value={target} onChange={e => setTarget(e.target.value)} />
            </Field>
          )}
          <Field label="Trial share of traffic (%)">
            <input className={inputCls} inputMode="numeric" value={split} onChange={e => setSplit(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start (optional)">
              <DatePicker value={startDate} min={today} clearable onChange={v => setStartDate(v)} placeholder="Now" />
            </Field>
            <Field label="End (optional)">
              <DatePicker value={endDate} min={startDate || today} clearable onChange={v => setEndDate(v)} placeholder="Campaign end" />
            </Field>
          </div>
        </div>
        {!campaigns.length && <p className="text-xs text-foreground-muted">No Search or Display campaigns synced yet.</p>}
        {campaignId && problems.length > 0 && (
          <ul className="text-xs text-red-600 dark:text-red-400 list-disc pl-5">
            {problems.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <button type="button" className={btnGhost} disabled={!!busy || problems.length > 0} onClick={() => send(true)}>
            {busy === 'preview' && <Loader2 className="w-4 h-4 animate-spin" />} Check with Google
          </button>
          <button type="button" className={btnPrimary} disabled={!!busy || problems.length > 0} onClick={() => send(false)}>
            {busy === 'create' && <Loader2 className="w-4 h-4 animate-spin" />} Create and schedule
          </button>
        </div>
      </div>
    </Section>
  )
}
