'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, Badge, btnGhost, when } from '@/components/admin/kit/core'
import { Card } from '@/components/admin/kit/layout'
import { useActionToast } from '@/components/admin/kit/toast'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import type { SkillMeta } from '@controller/lib/outreach/agent/types'
import { API, versionRef, type SkillSummary, type SkillValidation, type SkillVersionRow } from './shared'
import SkillEditor from './SkillEditor'
import SkillPreview from './SkillPreview'

type Detail = { skill: SkillSummary; versions: SkillVersionRow[]; lists: { id: string; name: string; pinned_version_id: string | null }[] }

const counts = (v: SkillVersionRow['validation']) => {
  const issues = ((v as SkillValidation).issues ?? []) as SkillValidation['issues']
  const errors = issues.filter(i => i.level === 'error').length
  return { errors, warnings: issues.length - errors, ok: (v as SkillValidation).ok }
}

export default function SkillDetail({ id, existingSlugs, onBack, onChanged }: { id: string; existingSlugs: string[]; onBack: () => void; onChanged: () => void }) {
  const canWrite = useCanWrite('ecom_outreach:write')
  const toast = useActionToast()
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [viewId, setViewId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [confirming, setConfirming] = useState(false)

  const load = useCallback(async () => {
    const { ok, data } = await api<Detail>(`${API}/skills/${id}`)
    if (!ok) return setError(data.error || 'Could not load the skill')
    setError(null)
    setD(data)
  }, [id])
  useEffect(() => {
    load()
  }, [load])

  async function makeCurrent(v: SkillVersionRow) {
    setBusy(v.id)
    const { ok, data } = await api(`${API}/skills/${id}`, { method: 'PATCH', json: { current_version_id: v.id } })
    setBusy(null)
    if (!ok) return toast.error(data.error || 'Could not change the current version')
    toast.success(`v${v.version} is now current`)
    await load()
    onChanged()
  }

  async function addVersion(content: string) {
    const { ok, data } = await api<{ validation?: SkillValidation; version?: SkillVersionRow }>(`${API}/skills/${id}/versions`, { method: 'POST', json: { content } })
    if (!ok) return { ok: false, error: data.error, validation: data.validation }
    toast.success(`Uploaded v${data.version?.version ?? ''}`.trim())
    setAdding(false)
    setDraft('')
    await load()
    onChanged()
    return { ok: true }
  }

  async function archive() {
    setBusy('archive')
    const { ok, data } = await api(`${API}/skills/${id}`, { method: 'DELETE' })
    setBusy(null)
    setConfirming(false)
    if (!ok) return toast.error(data.error || 'Could not archive')
    toast.success('Skill archived')
    onChanged()
    onBack()
  }

  if (error) return <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!d) return <div className="h-48 rounded-xl border border-border-default bg-surface-elevated animate-pulse" />
  const { skill, versions, lists } = d
  const viewing = versions.find(v => v.id === viewId) ?? null
  const previewing = viewing ?? versions.find(v => v.id === skill.current_version_id) ?? versions[0] ?? null
  const languages = ((previewing?.meta as Partial<SkillMeta> | undefined)?.languages ?? []) as string[]
  const archived = !!skill.archived_at

  return (
    <div className="space-y-5">
      <Card
        title={skill.title}
        hint={<span className="font-mono">{skill.slug}</span>}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {skill.is_default && <Badge tone="green">Default</Badge>}
            {archived && <Badge tone="amber">Archived</Badge>}
            <button type="button" className={btnGhost} onClick={onBack}>
              Back to skills
            </button>
            {canWrite && !archived && !confirming && (
              <button type="button" className={btnGhost} onClick={() => setAdding(a => !a)}>
                Upload new version
              </button>
            )}
            {canWrite && !archived && !confirming && (
              <button type="button" className={btnGhost} onClick={() => setConfirming(true)}>
                Archive
              </button>
            )}
            {confirming && (
              <>
                <span className="text-xs text-foreground-muted">New runs will skip it. Runs and pinned lists keep working.</span>
                <button type="button" className={btnGhost} disabled={busy === 'archive'} onClick={archive}>
                  Confirm archive
                </button>
                <button type="button" className={btnGhost} onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </>
            )}
          </div>
        }
      >
        {skill.description && <p className="text-sm text-foreground-muted">{skill.description}</p>}
      </Card>

      {adding && (
        <SkillEditor
          title="New version"
          hint="Saved as the next version and made current."
          content={draft}
          setContent={setDraft}
          onSave={addVersion}
          saveLabel="Save version"
          canWrite={canWrite}
          existingSlugs={existingSlugs.filter(s => s !== skill.slug)}
          onCancel={() => setAdding(false)}
        />
      )}

      <Card title="Versions" flush>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-foreground-muted border-b border-border-default">
                <th className="px-5 py-1.5">Version</th>
                <th className="py-1.5 pr-3">Source</th>
                <th className="py-1.5 pr-3">Created</th>
                <th className="py-1.5 pr-3">Check</th>
                <th className="py-1.5 pr-3">SHA-256</th>
                <th className="py-1.5 pr-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {versions.map(v => {
                const c = counts(v.validation)
                const current = v.id === skill.current_version_id
                return (
                  <tr key={v.id} className="border-t border-border-default/60">
                    <td className="px-5 py-2 whitespace-nowrap">
                      <span className="tabular-nums font-medium">{versionRef(v)}</span> {current && <Badge tone="green">Current</Badge>}
                    </td>
                    <td className="py-2 pr-3">{v.source}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{when(v.created_at)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      <Badge tone={c.ok ? 'green' : 'red'}>{c.ok ? 'Valid' : 'Invalid'}</Badge>
                      {(c.errors > 0 || c.warnings > 0) && <span className="ml-1.5 text-xs text-foreground-muted">{`${c.errors} errors, ${c.warnings} warnings`}</span>}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{v.sha256.slice(0, 8)}</td>
                    <td className="py-2 pr-5">
                      <div className="flex justify-end gap-2">
                        <button type="button" className={btnGhost} aria-label={`View ${versionRef(v)}`} onClick={() => setViewId(viewId === v.id ? null : v.id)}>
                          {viewId === v.id ? 'Hide' : 'View'}
                        </button>
                        {canWrite && !current && !archived && (
                          <button type="button" className={btnGhost} aria-label={`Make ${versionRef(v)} current`} disabled={busy === v.id} onClick={() => makeCurrent(v)}>
                            Make current
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {viewing && (
        <Card title={`Content of ${versionRef(viewing)}`}>
          <pre aria-label="Version content" className="max-h-[32rem] overflow-auto rounded-lg bg-surface-secondary p-3 text-xs font-mono whitespace-pre-wrap break-words">{viewing.content}</pre>
        </Card>
      )}

      {previewing && (
        <Card title="Preview" hint={`Renders ${versionRef(previewing)} exactly as the agent would see it.`}>
          <SkillPreview key={previewing.id} versionId={previewing.id} languages={languages} />
        </Card>
      )}

      <Card title="Lists using this skill" flush>
        {!lists.length ? (
          <p className="px-5 pb-5 text-sm text-foreground-muted">No list uses it yet. Pick it on the Lists tab, or make it the program default.</p>
        ) : (
          <ul className="divide-y divide-border-default/60">
            {lists.map(l => {
              const pinned = versions.find(v => v.id === l.pinned_version_id)
              return (
                <li key={l.id} className="px-5 py-2.5 flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{l.name}</span>
                  <Badge>{pinned ? `Pinned ${versionRef(pinned)}` : 'Follows current'}</Badge>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
