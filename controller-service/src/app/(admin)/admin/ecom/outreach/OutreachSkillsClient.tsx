'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, Badge, btnGhost, btnPrimary, when } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import {
  AGENT_STATUS_LABEL, AGENT_STATUS_TONE, API, AUDIENCE_LABEL, CHANNEL_LABEL, FLOW_LABEL, MAX_SKILL_BYTES, PURPOSE_LABEL, TRIGGER_LABEL,
  type SkillSummary, type SkillValidation, type SkillVersionRow,
} from './shared'
import SkillEditor, { type SaveResult } from './SkillEditor'
import SkillDetail from './SkillDetail'
import SkillCatalog from './SkillCatalog'

type Builtin = { slug: string; title: string; description: string; content: string; audience?: string }
type Listing = { skills: SkillSummary[]; builtins: Builtin[]; defaultSkillId: string | null }

const BLANK = `---
name: my-agent
title: My agent
description: What this agent does in one line.
audience: shopper
purpose: transactional
flow: one_call
channels: [voice]
languages: [en]
inputs:
  customer_phone: { type: phone, required: true, role: contact }
  customer_name: { type: text, role: name }
trigger:
  event: manual
outcomes: [done, declined, unreachable]
tools: [getJob, setOutcome, endCall]
---

You are calling {{inputs.customer_name}}. Say why you are calling.

## Voice
Keep it short: one question at a time. Call setOutcome before you end the call.
`

function download(b: Builtin) {
  const url = URL.createObjectURL(new Blob([b.content], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${b.slug}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// The open agent lives in ?skill=<id> so a reload or a shared link lands on it.
const setSkillParam = (id: string | null) => {
  try {
    const u = new URL(window.location.href)
    if (id) u.searchParams.set('skill', id)
    else u.searchParams.delete('skill')
    window.history.replaceState(null, '', u)
  } catch {
    /* no URL to update */
  }
}

export const triggerText = (s: Pick<SkillSummary, 'trigger_event'>) => TRIGGER_LABEL[s.trigger_event] ?? s.trigger_event

export default function OutreachSkillsClient() {
  const canWrite = useCanWrite('ecom_outreach:write')
  const toast = useActionToast()
  const sp = useSearchParams()
  const fileRef = useRef<HTMLInputElement>(null)
  const [data, setData] = useState<Listing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [openId, setOpenId] = useState<string | null>(sp?.get('skill') || null)
  const [chooser, setChooser] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    const { ok, data: d } = await api<Listing>(`${API}/skills?program=showcase-offer&archived=1`)
    if (!ok) return setError(d.error || 'Could not load the agents')
    setError(null)
    setData(d)
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const open = (id: string | null) => {
    setOpenId(id)
    setSkillParam(id)
  }

  async function create(content: string): Promise<SaveResult> {
    const { ok, data: d } = await api<{ skill: SkillSummary; version: SkillVersionRow; validation: SkillValidation }>(`${API}/skills`, { method: 'POST', json: { content } })
    if (!ok) return { ok: false, error: d.error, validation: d.validation }
    toast.success(`Created ${d.skill.title}. It is a draft until you activate it.`)
    setCreating(false)
    setDraft('')
    await load()
    open(d.skill.id)
    return { ok: true }
  }

  const startNew = (content = BLANK) => {
    setDraft(content)
    setChooser(false)
    setCreating(true)
    open(null)
  }

  function pickFile(f: File | undefined) {
    if (!f) return
    if (f.size > MAX_SKILL_BYTES) return toast.error('That file is over 24 KB')
    const r = new FileReader()
    r.onload = () => startNew(String(r.result ?? ''))
    r.onerror = () => toast.error('Could not read the file')
    r.readAsText(f)
    if (fileRef.current) fileRef.current.value = ''
  }

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!data) return <div className="h-48 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />
  const slugs = data.skills.map(s => s.slug)

  if (openId && !creating)
    return (
      <div className="space-y-5">
        <SkillDetail key={openId} id={openId} existingSlugs={slugs} onBack={() => open(null)} onChanged={load} />
      </div>
    )

  const active = data.skills.filter(s => !s.archived_at)
  const archivedCount = data.skills.length - active.length
  const rows = showArchived ? data.skills : active

  return (
    <div className="space-y-5">
      {creating ? (
        <SkillEditor
          title="New agent"
          hint="A Markdown file: front matter (name, title, audience, inputs, trigger, outcomes, tools) then ## Voice, ## WhatsApp and ## Follow-up sections."
          content={draft}
          setContent={setDraft}
          onSave={create}
          saveLabel="Create agent"
          canWrite={canWrite}
          existingSlugs={slugs}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Card
          title="Agents"
          hint="An agent is a Markdown file that tells the AI how to talk, which tools it may use, what starts it and how it ends. It works through jobs."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {archivedCount > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
                  <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
                  {`Show archived (${archivedCount})`}
                </label>
              )}
              <button type="button" className={btnPrimary} disabled={!canWrite} aria-expanded={chooser} onClick={() => setChooser(c => !c)}>
                New agent
              </button>
            </div>
          }
          flush
        >
          {!rows.length ? (
            <p className="px-5 pb-5 text-sm text-foreground-muted">No agents yet. Choose New agent to start from a template.</p>
          ) : (
            <ul className="divide-y divide-border-default/60">
              {rows.map(s => (
                <li key={s.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground truncate">{s.title}</span>
                      <Badge tone={AGENT_STATUS_TONE[s.status]}>{AGENT_STATUS_LABEL[s.status] ?? s.status}</Badge>
                      <Badge tone="blue">{AUDIENCE_LABEL[s.audience] ?? s.audience}</Badge>
                      {s.purpose === 'promotional' && <Badge tone="amber">{PURPOSE_LABEL.promotional}</Badge>}
                      {s.is_default && <Badge tone="green">Default</Badge>}
                      {s.archived_at && <Badge tone="amber">Archived</Badge>}
                    </div>
                    {s.description && <div className="text-xs text-foreground-muted truncate">{s.description}</div>}
                    <div className="text-xs text-foreground-muted">
                      <span className="font-mono">{s.slug}</span>
                      {` · Trigger: ${triggerText(s)}`}
                      {s.flow ? ` · ${FLOW_LABEL[s.flow] ?? s.flow}` : ''}
                      {s.channels.length ? ` · ${s.channels.map(c => CHANNEL_LABEL[c] ?? c).join(', ')}` : ''}
                      {s.current_version ? ` · v${s.current_version}` : ''}
                      {` · updated ${when(s.updated_at)}`}
                    </div>
                  </div>
                  <button type="button" className={btnGhost} aria-label={`Open ${s.title}`} onClick={() => open(s.id)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {chooser && !creating && (
        <Card title="New agent" hint="Start from a template, upload a Markdown file or begin with a blank agent. Each agent's name must be unique, so change it in the file.">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={btnGhost} disabled={!canWrite} onClick={() => startNew()}>
                Start blank
              </button>
              <input ref={fileRef} type="file" aria-label="Upload an agent file" accept=".md,.markdown,.txt,text/markdown,text/plain" disabled={!canWrite} onChange={e => pickFile(e.target.files?.[0])} className="block text-sm text-foreground-muted file:mr-3 file:rounded-lg file:border file:border-border-default file:bg-surface file:px-3 file:py-2 file:text-sm file:text-foreground" />
              <button type="button" className={btnGhost} onClick={() => setChooser(false)}>
                Close
              </button>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-foreground-muted mb-1">Templates</h3>
              {!data.builtins.length ? (
                <p className="text-sm text-foreground-muted">No templates available.</p>
              ) : (
                <ul className="divide-y divide-border-default/60">
                  {data.builtins.map(b => (
                    <li key={b.slug} className="py-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{b.title}</span>
                          <Badge tone="blue">{AUDIENCE_LABEL[b.audience ?? 'lead'] ?? b.audience}</Badge>
                        </div>
                        <div className="text-xs text-foreground-muted">{b.description}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button type="button" className={btnGhost} aria-label={`Use ${b.title} as a starting point`} disabled={!canWrite} onClick={() => startNew(b.content)}>
                          Use template
                        </button>
                        <button type="button" className={btnGhost} aria-label={`Download ${b.title}`} onClick={() => download(b)}>
                          Download .md
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {!creating && <SkillCatalog />}
    </div>
  )
}
