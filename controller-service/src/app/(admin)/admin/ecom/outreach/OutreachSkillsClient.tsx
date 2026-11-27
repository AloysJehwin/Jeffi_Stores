'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { api, Badge, btnGhost, btnPrimary, when } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import { API, CHANNEL_LABEL, FLOW_LABEL, type SkillSummary, type SkillValidation, type SkillVersionRow } from './shared'
import SkillEditor, { type SaveResult } from './SkillEditor'
import SkillDetail from './SkillDetail'
import SkillCatalog from './SkillCatalog'

type Builtin = { slug: string; title: string; description: string; content: string }
type Listing = { skills: SkillSummary[]; builtins: Builtin[]; defaultSkillId: string | null }

function download(b: Builtin) {
  const url = URL.createObjectURL(new Blob([b.content], { type: 'text/markdown' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `${b.slug}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// The open skill lives in ?skill=<id> so a reload or a shared link lands on it.
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

export default function OutreachSkillsClient() {
  const canWrite = useCanWrite('ecom_outreach:write')
  const toast = useActionToast()
  const sp = useSearchParams()
  const [data, setData] = useState<Listing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [openId, setOpenId] = useState<string | null>(sp?.get('skill') || null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')

  const load = useCallback(async () => {
    const { ok, data: d } = await api<Listing>(`${API}/skills?program=showcase-offer&archived=1`)
    if (!ok) return setError(d.error || 'Could not load the skills')
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
    toast.success(`Created ${d.skill.title}`)
    setCreating(false)
    setDraft('')
    await load()
    open(d.skill.id)
    return { ok: true }
  }

  const startNew = (content = '') => {
    setDraft(content)
    setCreating(true)
    open(null)
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
          title="New skill"
          hint="A Markdown file: front matter (name, title, flow, channels, languages, tools) then ## Voice, ## WhatsApp and ## Follow-up sections."
          content={draft}
          setContent={setDraft}
          onSave={create}
          saveLabel="Create skill"
          canWrite={canWrite}
          existingSlugs={slugs}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <Card
          title="Skills"
          hint="A skill is a Markdown file that tells the outreach agent how to talk, which tools it may use and when to hand off."
          action={
            <div className="flex flex-wrap items-center gap-2">
              {archivedCount > 0 && (
                <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
                  <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
                  {`Show archived (${archivedCount})`}
                </label>
              )}
              <button type="button" className={btnPrimary} disabled={!canWrite} onClick={() => startNew()}>
                New skill
              </button>
            </div>
          }
          flush
        >
          {!rows.length ? (
            <p className="px-5 pb-5 text-sm text-foreground-muted">No skills yet. Start from one of the templates below, or create your own.</p>
          ) : (
            <ul className="divide-y divide-border-default/60">
              {rows.map(s => (
                <li key={s.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground truncate">{s.title}</span>
                      {s.is_default && <Badge tone="green">Default</Badge>}
                      {s.archived_at && <Badge tone="amber">Archived</Badge>}
                    </div>
                    <div className="text-xs text-foreground-muted">
                      <span className="font-mono">{s.slug}</span>
                      {s.flow ? ` · ${FLOW_LABEL[s.flow] ?? s.flow}` : ''}
                      {s.channels.length ? ` · ${s.channels.map(c => CHANNEL_LABEL[c] ?? c).join(', ')}` : ''}
                      {s.current_version ? ` · v${s.current_version}` : ''}
                      {` · ${s.list_count} ${s.list_count === 1 ? 'list' : 'lists'}`}
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

      {!creating && (
        <Card title="Start from a template" hint="Built-in skills. Use one as a starting point, then change its name: each skill's name must be unique.">
          {!data.builtins.length ? (
            <p className="text-sm text-foreground-muted">No templates available.</p>
          ) : (
            <ul className="divide-y divide-border-default/60">
              {data.builtins.map(b => (
                <li key={b.slug} className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{b.title}</div>
                    <div className="text-xs text-foreground-muted">{b.description}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" className={btnGhost} aria-label={`Use ${b.title} as a starting point`} disabled={!canWrite} onClick={() => startNew(b.content)}>
                      Use as a starting point
                    </button>
                    <button type="button" className={btnGhost} aria-label={`Download ${b.title}`} onClick={() => download(b)}>
                      Download .md
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <SkillCatalog />
    </div>
  )
}
