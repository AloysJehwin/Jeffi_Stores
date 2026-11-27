'use client'

import { useEffect, useMemo, useState } from 'react'
import { api, Badge } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import type { SkillMeta } from '@controller/lib/outreach/agent/types'
import {
  API, AUDIENCE_LABEL, CHANNEL_LABEL, EFFECT_TONE, fmtMinutes, GROUP_LABEL, PURPOSE_LABEL, readToolsForm, TRIGGER_LABEL, writeToolsList,
} from './shared'

export type CatalogTool = { name: string; description: string; channels: string[]; effect: string; mandatory: boolean; group: string }

let catalogCache: Promise<CatalogTool[] | null> | null = null

/** The tool catalog, fetched once per page load. */
export function useToolCatalog() {
  const [tools, setTools] = useState<CatalogTool[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    if (!catalogCache) catalogCache = api<{ tools: CatalogTool[] }>(`${API}/catalog`).then(({ ok, data }) => (ok ? data.tools : null))
    catalogCache.then(t => {
      if (!live) return
      if (t) setTools(t)
      else {
        catalogCache = null
        setError('Could not load the tool catalog')
      }
    })
    return () => {
      live = false
    }
  }, [])
  return { tools, error }
}

const Muted = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-foreground-muted">{children}</p>

export function InputsPanel({ meta }: { meta: SkillMeta }) {
  const entries = Object.entries(meta.inputs ?? {})
  return (
    <Card title="Inputs" hint="What each job carries. Declared in the front matter under inputs:.">
      {!entries.length ? (
        <Muted>No inputs declared. Add an inputs: block with one role: contact phone to run this agent as jobs.</Muted>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground-muted border-b border-border-default">
                <th className="py-1.5 pr-3">Name</th>
                <th className="py-1.5 pr-3">Type</th>
                <th className="py-1.5 pr-3">Required</th>
                <th className="py-1.5 pr-3">Role</th>
                <th className="py-1.5">Description</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([name, s]) => (
                <tr key={name} className="border-t border-border-default/60 align-top">
                  <td className="py-1.5 pr-3 font-mono text-xs whitespace-nowrap">{name}</td>
                  <td className="py-1.5 pr-3 text-xs">
                    {s.type}
                    {s.enum?.length ? <span className="text-foreground-muted">{` (${s.enum.join(' | ')})`}</span> : null}
                  </td>
                  <td className="py-1.5 pr-3">{s.required ? <Badge tone="blue">Required</Badge> : <span className="text-xs text-foreground-muted">Optional</span>}</td>
                  <td className="py-1.5 pr-3 text-xs">{s.role ?? '-'}</td>
                  <td className="py-1.5 text-xs text-foreground-muted">{s.description || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function TriggerPanel({ meta }: { meta: SkillMeta }) {
  const t = meta.trigger
  const when = Object.entries(t?.when ?? {})
  const rows: [string, React.ReactNode][] = [
    ['Audience', AUDIENCE_LABEL[meta.audience] ?? meta.audience],
    ['Purpose', PURPOSE_LABEL[meta.purpose] ?? meta.purpose],
    ['Event', t ? TRIGGER_LABEL[t.event] ?? t.event : 'Manual'],
  ]
  if (t && t.event !== 'manual') {
    rows.push(['Delay', fmtMinutes(t.delayMinutes)], ['Looks back', fmtMinutes(t.lookbackMinutes)])
    rows.push(['Dedupe on', t.dedupe ? <span className="font-mono text-xs">{t.dedupe}</span> : 'None'])
    rows.push(['Conditions', when.length ? when.map(([k, v]) => `${k}: ${v}`).join(', ') : 'None'])
  }
  return (
    <Card title="Trigger" hint="What starts a job. Manual agents only run jobs you add.">
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-2 text-sm">
            <dt className="w-24 shrink-0 text-xs text-foreground-muted pt-0.5">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

export function OutcomesPanel({ meta }: { meta: SkillMeta }) {
  const list = meta.outcomes ?? []
  return (
    <Card title="Outcomes" hint="The codes setOutcome accepts.">
      {!list.length ? (
        <Muted>None declared: setOutcome takes any slug.</Muted>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {list.map(o => (
            <span key={o} className="font-mono text-xs">
              <Badge>{o}</Badge>
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}

/** Catalog grouped by area. Tick edits the front matter `tools:` list; a per-channel map is shown read-only. */
export function ToolsPanel({ meta, content, setContent, canEdit }: { meta: SkillMeta; content?: string; setContent?: (s: string) => void; canEdit: boolean }) {
  const { tools, error } = useToolCatalog()
  const form = useMemo(() => (content != null ? readToolsForm(content) : ({ form: 'map' } as const)), [content])
  const editable = canEdit && !!setContent && content != null && form.form !== 'map'
  const selected = useMemo(() => {
    if (form.form === 'list') return new Set(form.names)
    return new Set(Object.values(meta.tools ?? {}).flat())
  }, [form, meta.tools])
  const groups = useMemo(() => {
    const m = new Map<string, CatalogTool[]>()
    for (const t of tools ?? []) m.set(t.group, [...(m.get(t.group) ?? []), t])
    return [...m.entries()].sort((a, b) => Object.keys(GROUP_LABEL).indexOf(a[0]) - Object.keys(GROUP_LABEL).indexOf(b[0]))
  }, [tools])
  const known = new Set((tools ?? []).map(t => t.name))
  const unknown = [...selected].filter(n => tools && !known.has(n))

  function toggle(t: CatalogTool, on: boolean) {
    if (!editable || !setContent || content == null) return
    const cur = form.form === 'list' ? form.names : []
    const next = on ? [...cur, t.name] : cur.filter(n => n !== t.name)
    const order = new Map((tools ?? []).map((x, i) => [x.name, i]))
    next.sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999))
    setContent(writeToolsList(content, [...new Set(next)]))
  }

  return (
    <Card
      title="Tools"
      hint={
        form.form === 'map' && content != null
          ? 'This file lists tools per channel (voice, whatsapp, follow_up). Edit the tools: block in the text; the panel shows them read-only.'
          : editable
            ? 'Tick a tool to add it to the tools: list in the front matter. Always-on tools cannot be removed.'
            : 'The tools this version may use. Edit the agent to change them.'
      }
    >
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {!tools && !error && <div className="h-24 rounded-lg bg-surface-secondary animate-pulse" />}
      {!!unknown.length && <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">{`Not in the catalog: ${unknown.join(', ')}`}</p>}
      <div className="space-y-4">
        {groups.map(([g, list]) => (
          <div key={g}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-1">{GROUP_LABEL[g] ?? g}</h3>
            <ul className="divide-y divide-border-default/60">
              {list.map(t => {
                const on = t.mandatory || selected.has(t.name)
                return (
                  <li key={t.name} className="py-1.5">
                    <label className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" aria-label={t.name} checked={on} disabled={t.mandatory || !editable} onChange={e => toggle(t, e.target.checked)} />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs">{t.name}</span>
                          <Badge tone={EFFECT_TONE[t.effect] ?? 'muted'}>{t.effect}</Badge>
                          {t.mandatory && <Badge tone="blue">Always on</Badge>}
                          <span className="text-[11px] text-foreground-muted">{t.channels.map(c => CHANNEL_LABEL[c] ?? c).join(', ')}</span>
                        </span>
                        <span className="block text-xs text-foreground-muted">{t.description}</span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  )
}

/** The four side panels for a parsed skill. Pass content + setContent from the editor to make Tools editable. */
export default function AgentPanels({ meta, content, setContent, canEdit }: { meta: SkillMeta; content?: string; setContent?: (s: string) => void; canEdit: boolean }) {
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-start">
      <InputsPanel meta={meta} />
      <ToolsPanel meta={meta} content={content} setContent={setContent} canEdit={canEdit} />
      <TriggerPanel meta={meta} />
      <OutcomesPanel meta={meta} />
    </div>
  )
}
