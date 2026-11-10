'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, ChevronDown } from 'lucide-react'
import CollapsibleSection from '@/components/admin/CollapsibleSection'
import DatePicker from '@/components/ui/DatePicker'
import { PlatformAppsLoading } from './SetupLoading'
import { PageBody, PageHeader, StatusBadge, Tabs, CopyValue, api, btnGhost, btnPrimary, inputCls, useActionToast, type StatusMap } from '@/components/admin/kit'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import type { ManualState } from '@/lib/setup-guide/progress'
import type { ResolvedHowTo, ResolvedOwnCredentials, ResolvedPlatformItem, ResolvedRegister, ResolvedStep, SetupGuideResult, StatusCounts } from '@/lib/setup-guide/status'
import type { StepStatus } from '@/lib/setup-guide/registry'

export type GuidePayload = SetupGuideResult & { canWrite: boolean; platform: boolean }
type Filter = 'all' | 'todo' | 'in_progress' | 'needs_attention' | 'done'
type Manual = { state: ManualState | null; appliedAt?: string | null; note?: string | null }

export const STEP_STATUS: StatusMap = {
  todo: { label: 'To do', tone: 'muted' },
  in_progress: { label: 'Waiting', tone: 'blue' },
  done: { label: 'Done', tone: 'green' },
  needs_attention: { label: 'Needs attention', tone: 'red' },
  skipped: { label: 'Skipped', tone: 'muted' },
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'todo', label: 'To do' },
  { id: 'in_progress', label: 'Waiting' },
  { id: 'needs_attention', label: 'Needs attention' },
  { id: 'done', label: 'Done' },
]

const OPEN: StepStatus[] = ['todo', 'in_progress', 'needs_attention']
const today = () => new Date().toISOString().slice(0, 10)
const fmt = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function ProgressHeader({ counts }: { counts: StatusCounts }) {
  const base = Math.max(1, counts.total - counts.skipped)
  const pct = Math.round((counts.done / base) * 100)
  return (
    <div className="rounded-xl border border-border-default bg-surface-elevated p-4 space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-semibold text-foreground">
          {counts.done} of {base} done
        </p>
        <p className="text-xs text-foreground-muted">
          {counts.needs_attention > 0 && <span className="text-red-600 dark:text-red-400">{counts.needs_attention} need attention · </span>}
          {counts.in_progress > 0 && <span>{counts.in_progress} waiting · </span>}
          {counts.skipped > 0 && <span>{counts.skipped} skipped</span>}
        </p>
      </div>
      <div className="h-2 rounded-full bg-surface-secondary overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-accent-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-600 hover:underline break-all">
      {children}
      <ExternalLink className="w-3 h-3 shrink-0" />
    </a>
  )
}

function GoLink({ href, external, primary, children }: { href: string; external: boolean; primary?: boolean; children: React.ReactNode }) {
  const cls = primary ? btnPrimary : btnGhost
  if (external)
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children} <ExternalLink className="w-3.5 h-3.5" />
      </a>
    )
  return (
    <Link href={ap(href)} className={cls}>
      {children}
    </Link>
  )
}

function RegisterList({ items }: { items: ResolvedRegister[] }) {
  if (!items.length) return null
  return (
    <GuideBlock title="What to register">
      <ul className="space-y-2">
        {items.map(r => (
          <li key={r.label} className="min-w-0">
            <p className="text-xs text-foreground-muted">{r.label}</p>
            <div className="flex items-start gap-2 min-w-0">
              <code className="min-w-0 flex-1 break-all rounded bg-surface-secondary px-2 py-1 text-xs text-foreground">{r.value}</code>
              <span className="pt-1">
                <CopyValue value={r.value} label={`Copy ${r.label}`} />
              </span>
            </div>
            {r.hint && <p className="text-xs text-foreground-muted mt-0.5">{r.hint}</p>}
          </li>
        ))}
      </ul>
    </GuideBlock>
  )
}

function GuideBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{title}</p>
      {children}
    </div>
  )
}

const List = ({ items, ordered }: { items: string[]; ordered?: boolean }) => {
  if (!items.length) return null
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={`${ordered ? 'list-decimal' : 'list-disc'} pl-5 space-y-1 text-sm text-foreground-secondary`}>
      {items.map(i => (
        <li key={i}>{i}</li>
      ))}
    </Tag>
  )
}

function OwnCredentialsGuide({ g }: { g: ResolvedOwnCredentials }) {
  return (
    <div className="space-y-4 rounded-lg border border-border-default bg-surface p-3 sm:p-4">
      <p className="text-sm text-foreground-secondary">{g.summary}</p>
      {g.consoles.length > 0 && (
        <GuideBlock title="Consoles">
          <ul className="space-y-1 text-sm">
            {g.consoles.map(c => (
              <li key={c.url}>
                <Ext href={c.url}>{c.label}</Ext>
              </li>
            ))}
          </ul>
        </GuideBlock>
      )}
      {g.create.length > 0 && (
        <GuideBlock title="What to create">
          <List items={g.create} />
        </GuideBlock>
      )}
      <GuideBlock title="Steps">
        <List items={g.steps} ordered />
      </GuideBlock>
      <RegisterList items={g.register} />
      {g.permissions.length > 0 && (
        <GuideBlock title="Permissions to request">
          <ul className="space-y-1 text-sm">
            {g.permissions.map(p => (
              <li key={p.name} className="text-foreground-secondary">
                <code className="text-xs text-foreground">{p.name}</code>: {p.why}
              </li>
            ))}
          </ul>
        </GuideBlock>
      )}
      {g.approval.length > 0 && (
        <GuideBlock title="Approvals and typical waits">
          <ul className="space-y-1 text-sm text-foreground-secondary">
            {g.approval.map(a => (
              <li key={a.step}>
                {a.step}
                {a.wait && <span className="text-foreground-muted"> · {a.wait}</span>}
              </li>
            ))}
          </ul>
        </GuideBlock>
      )}
      <GuideBlock title="Paste back">
        <p className="text-sm text-foreground-secondary">{g.paste.fields.join(', ')}</p>
        <div>
          <GoLink href={g.paste.href} external={g.paste.external}>
            {g.paste.label}
          </GoLink>
        </div>
      </GuideBlock>
      {g.rejections.length > 0 && (
        <GuideBlock title="Common rejections">
          <List items={g.rejections} />
        </GuideBlock>
      )}
      {g.notes.length > 0 && (
        <GuideBlock title="Notes">
          <List items={g.notes} />
        </GuideBlock>
      )}
    </div>
  )
}

function HowToGuide({ h }: { h: ResolvedHowTo }) {
  return (
    <div className="space-y-4 rounded-lg border border-border-default bg-surface p-3 sm:p-4">
      {h.before.length > 0 && (
        <GuideBlock title="Have ready">
          <List items={h.before} />
        </GuideBlock>
      )}
      <GuideBlock title="Steps">
        <List items={h.steps} ordered />
      </GuideBlock>
      {h.wait && (
        <GuideBlock title="Typical wait">
          <p className="text-sm text-foreground-secondary">{h.wait}</p>
        </GuideBlock>
      )}
      {h.links.length > 0 && (
        <GuideBlock title="Links">
          <ul className="space-y-1 text-sm">
            {h.links.map(l => (
              <li key={l.url}>
                <Ext href={l.url}>{l.label}</Ext>
              </li>
            ))}
          </ul>
        </GuideBlock>
      )}
      {h.notes.length > 0 && (
        <GuideBlock title="Notes">
          <List items={h.notes} />
        </GuideBlock>
      )}
    </div>
  )
}

function GuideToggle({ open, onClick, children }: { open: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={btnGhost} aria-expanded={open} onClick={onClick}>
      {children}
      <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
  )
}

function ManualControls({ state, canWrite, busy, onSave }: { state: ManualState | null; canWrite: boolean; busy: boolean; onSave: (m: Manual) => void }) {
  const [applying, setApplying] = useState(false)
  const [date, setDate] = useState(today())
  const [note, setNote] = useState('')
  if (!canWrite) return null
  if (applying)
    return (
      <div className="flex w-full flex-wrap items-end gap-2">
        <div className="text-xs space-y-1">
          <span className="text-foreground-muted">Applied on</span>
          <DatePicker value={date} max={today()} onChange={setDate} aria-label="Applied on" className="w-44" />
        </div>
        <label className="text-xs space-y-1 min-w-0 flex-1 basis-40">
          <span className="text-foreground-muted">Note (optional)</span>
          <input className={inputCls} value={note} maxLength={500} onChange={e => setNote(e.target.value)} placeholder="Reference number, contact…" />
        </label>
        <button type="button" disabled={busy} className={btnPrimary} onClick={() => onSave({ state: 'applied', appliedAt: date || null, note: note || null })}>
          Save
        </button>
        <button type="button" className={btnGhost} onClick={() => setApplying(false)}>
          Cancel
        </button>
      </div>
    )
  return (
    <>
      {state !== 'applied' && (
        <button type="button" disabled={busy} className={btnGhost} onClick={() => setApplying(true)}>
          Mark applied
        </button>
      )}
      {state !== 'approved' && (
        <button type="button" disabled={busy} className={btnGhost} onClick={() => onSave({ state: 'approved' })}>
          Approved
        </button>
      )}
      {state !== 'skipped' && (
        <button type="button" disabled={busy} className={btnGhost} onClick={() => onSave({ state: 'skipped' })}>
          Skip
        </button>
      )}
      {state && (
        <button type="button" disabled={busy} className={btnGhost} onClick={() => onSave({ state: null })}>
          Clear
        </button>
      )}
    </>
  )
}

function manualText(m: { state: ManualState; applied_at: string | null; note: string | null } | null) {
  if (!m) return null
  const label = m.state === 'applied' ? `You applied${m.applied_at ? ` on ${fmt(m.applied_at)}` : ''}` : m.state === 'approved' ? 'Marked approved' : 'Skipped'
  return m.note ? `${label} · ${m.note}` : label
}

function StepRow({ step, canWrite, busy, onSave }: { step: ResolvedStep; canWrite: boolean; busy: boolean; onSave: (id: string, m: Manual) => void }) {
  const [guide, setGuide] = useState<'how' | 'own' | null>(null)
  const toggle = (g: 'how' | 'own') => setGuide(cur => (cur === g ? null : g))
  const showConnect = !!step.connect && step.status !== 'done' && step.canOpen
  const manual = manualText(step.manual)
  return (
    <li className="min-w-0 border-t border-border-default py-3 first:border-t-0 first:pt-0 last:pb-0 space-y-2">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={step.status} map={STEP_STATUS} />
            <p className="min-w-0 break-words text-sm font-medium text-foreground">{step.title}</p>
            {step.optional && <span className="text-[11px] text-foreground-muted">Optional</span>}
          </div>
          <p className="text-sm text-foreground-secondary">{step.why}</p>
          {step.detail && <p className="text-xs text-foreground-muted">{step.detail}</p>}
          {manual && <p className="text-xs text-blue-700 dark:text-blue-400">{manual}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showConnect ? (
          <GoLink href={step.connect!} external={false} primary>
            Connect
          </GoLink>
        ) : step.canOpen ? (
          <GoLink href={step.href} external={step.external} primary={step.status === 'todo' || step.status === 'needs_attention'}>
            {step.status === 'done' ? 'Edit' : 'Open'}
          </GoLink>
        ) : (
          <span className="text-xs text-foreground-muted">You do not have access to this page</span>
        )}
        <ManualControls state={step.manual?.state ?? null} canWrite={canWrite} busy={busy} onSave={m => onSave(step.id, m)} />
        {step.howTo && (
          <GuideToggle open={guide === 'how'} onClick={() => toggle('how')}>
            How to do it
          </GuideToggle>
        )}
        {step.ownCredentials && (
          <GuideToggle open={guide === 'own'} onClick={() => toggle('own')}>
            Use your own credentials
          </GuideToggle>
        )}
      </div>
      {guide === 'how' && step.howTo && <HowToGuide h={step.howTo} />}
      {guide === 'own' && step.ownCredentials && <OwnCredentialsGuide g={step.ownCredentials} />}
    </li>
  )
}

function StoreGuide({ data, reload }: { data: GuidePayload; reload: () => Promise<void> }) {
  const canWrite = useCanWrite('setup_guide') && data.canWrite
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useActionToast()
  const save = useCallback(
    async (id: string, m: Manual) => {
      setBusy(id)
      const r = await api(`/api/admin/setup-guide/${encodeURIComponent(id)}`, { method: 'PATCH', json: m })
      setBusy(null)
      if (!r.ok) return toast.result(r)
      await reload()
    },
    [reload, toast]
  )
  const shown = (s: ResolvedStep) => filter === 'all' || s.status === filter
  const filterCount = (f: Filter) => (f === 'all' ? data.counts.total : data.counts[f])
  return (
    <div className="space-y-4">
      <ProgressHeader counts={data.counts} />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter steps">
        {FILTERS.map(f => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.id ? 'border-accent-500 bg-accent-500/10 text-accent-700 dark:text-accent-300' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'
            }`}
          >
            {f.label} <span className="tabular-nums text-foreground-muted">{filterCount(f.id)}</span>
          </button>
        ))}
      </div>
      {data.sections.map(sec => {
        const steps = data.steps.filter(s => s.section === sec.id)
        const visible = steps.filter(shown)
        if (!visible.length) return null
        const open = steps.filter(s => OPEN.includes(s.status) && !s.optional).length
        return (
          <CollapsibleSection key={`${sec.id}:${filter}`} title={sec.title} count={open} defaultOpen={filter !== 'all' || open > 0}>
            <ul>
              {visible.map(s => (
                <StepRow key={s.id} step={s} canWrite={canWrite} busy={busy === s.id} onSave={save} />
              ))}
            </ul>
          </CollapsibleSection>
        )
      })}
      {data.steps.every(s => !shown(s)) && <p className="py-8 text-center text-sm text-foreground-muted">No steps in this view.</p>}
    </div>
  )
}

function PlatformRow({ item, busy, onSave }: { item: ResolvedPlatformItem; busy: boolean; onSave: (id: string, m: Manual) => void }) {
  const [guide, setGuide] = useState(false)
  const manual = manualText(item.manual)
  return (
    <li className="min-w-0 border-t border-border-default py-3 first:border-t-0 first:pt-0 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={item.status} map={STEP_STATUS} />
        <p className="min-w-0 break-words text-sm font-medium text-foreground">{item.title}</p>
      </div>
      <p className="text-sm text-foreground-secondary">{item.why}</p>
      {(item.keys.present.length > 0 || item.keys.missing.length > 0) && (
        <p className="text-xs text-foreground-muted break-words">
          {item.keys.missing.length ? (
            <span className="text-red-600 dark:text-red-400">Missing in this admin-service: {item.keys.missing.join(', ')}</span>
          ) : (
            <span>All keys set ({item.keys.present.join(', ')})</span>
          )}
        </p>
      )}
      {manual && <p className="text-xs text-blue-700 dark:text-blue-400">{manual}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <ManualControls state={item.manual?.state ?? null} canWrite busy={busy} onSave={m => onSave(item.id, m)} />
        <button type="button" className={btnGhost} aria-expanded={guide} onClick={() => setGuide(g => !g)}>
          How to get it
          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${guide ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {guide && (
        <div className="space-y-4 rounded-lg border border-border-default bg-surface p-3 sm:p-4">
          {item.consoles.length > 0 && (
            <GuideBlock title="Consoles">
              <ul className="space-y-1 text-sm">
                {item.consoles.map(c => (
                  <li key={c.url}>
                    <Ext href={c.url}>{c.label}</Ext>
                  </li>
                ))}
              </ul>
            </GuideBlock>
          )}
          <GuideBlock title="Steps">
            <List items={item.steps} ordered />
          </GuideBlock>
          <RegisterList items={item.register} />
          {item.approval.length > 0 && (
            <GuideBlock title="Approvals and typical waits">
              <List items={item.approval.map(a => (a.wait ? `${a.step} · ${a.wait}` : a.step))} />
            </GuideBlock>
          )}
          {item.rejections.length > 0 && (
            <GuideBlock title="Common rejections">
              <List items={item.rejections} />
            </GuideBlock>
          )}
        </div>
      )}
    </li>
  )
}

function PlatformApps() {
  const [data, setData] = useState<{ items: ResolvedPlatformItem[]; counts: StatusCounts } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useActionToast()
  const load = useCallback(async () => {
    const r = await api<{ items: ResolvedPlatformItem[]; counts: StatusCounts }>('/api/admin/setup-guide/platform')
    if (r.ok) setData(r.data)
    else setError(r.data.error || 'Could not load')
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const save = useCallback(
    async (id: string, m: Manual) => {
      setBusy(id)
      const r = await api('/api/admin/setup-guide/platform', { method: 'PATCH', json: { itemId: id, ...m } })
      setBusy(null)
      if (!r.ok) return toast.result(r)
      await load()
    },
    [load, toast]
  )
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!data) return <PlatformAppsLoading />
  return (
    <div className="space-y-4">
      <ProgressHeader counts={data.counts} />
      <div className="rounded-xl border border-border-default bg-surface-elevated p-4 sm:p-5">
        <p className="mb-3 text-xs text-foreground-muted">Approvals only the platform does. Key status is read from this admin-service; approvals are what you mark here.</p>
        <ul>
          {data.items.map(i => (
            <PlatformRow key={i.id} item={i} busy={busy === i.id} onSave={save} />
          ))}
        </ul>
      </div>
    </div>
  )
}

export default function SetupGuideClient({ initial }: { initial: GuidePayload }) {
  const [data, setData] = useState(initial)
  const [tab, setTab] = useState<'store' | 'platform'>('store')
  const reload = useCallback(async () => {
    const r = await api<GuidePayload>('/api/admin/setup-guide')
    if (r.ok) setData(r.data)
  }, [])
  return (
    <PageBody>
      <PageHeader title="Setup guide" description="Everything to set up, connect and get approved, with what is already done ticked off." />
      {data.platform && (
        <Tabs
          tabs={[
            { id: 'store', label: 'Your store' },
            { id: 'platform', label: 'Platform apps' },
          ]}
          value={tab}
          onChange={setTab}
        />
      )}
      {tab === 'platform' && data.platform ? <PlatformApps /> : <StoreGuide data={data} reload={reload} />}
    </PageBody>
  )
}
