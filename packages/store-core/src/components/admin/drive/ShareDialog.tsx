'use client'

import { useEffect, useState } from 'react'
import { Loader2, Shield, Trash2, User, Users } from 'lucide-react'
import { Dialog, useActionToast } from '@/components/admin/kit'
import AdminSelect from '@/components/admin/AdminSelect'
import type { DriveLevel, DriveShare, DriveVisibility } from '@/lib/drive/types'
import { driveApi, type DrivePeople, type ShareTarget } from './api'
import { VISIBILITY_LABEL } from './DriveItems'

const LEVELS: { value: DriveLevel; label: string; hint: string }[] = [
  { value: 'view', label: 'Can view', hint: 'Open and download' },
  { value: 'edit', label: 'Can edit', hint: 'Also upload, rename, move and delete' },
  { value: 'manage', label: 'Can manage', hint: 'Also share with others' },
]

const roleLabel = (r: string) => r.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

/** Who can open a folder or file: the folder's visibility plus shares with people or roles. */
export default function ShareDialog({
  target,
  name,
  visibility,
  onVisibility,
  onClose,
}: {
  target: ShareTarget
  name: string
  /** Folders only. */
  visibility?: DriveVisibility
  onVisibility?: (v: DriveVisibility) => Promise<void>
  onClose: () => void
}) {
  const toast = useActionToast()
  const [shares, setShares] = useState<DriveShare[] | null>(null)
  const [people, setPeople] = useState<DrivePeople | null>(null)
  const [who, setWho] = useState('')
  const [level, setLevel] = useState<DriveLevel>('view')
  const [busy, setBusy] = useState(false)
  const [vis, setVis] = useState(visibility)

  useEffect(() => {
    driveApi.shares(target).then(d => setShares(d.shares), e => toast.error(e.message))
    driveApi.people().then(setPeople, () => setPeople({ admins: [], roles: [] }))
  }, [target.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const add = async () => {
    if (!who) return
    setBusy(true)
    try {
      const [kind, id] = who.split(':')
      const d = await driveApi.addShare(target, kind === 'role' ? { role: id } : { adminId: id }, level)
      setShares(d.shares)
      setWho('')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (s: DriveShare) => {
    try {
      setShares((await driveApi.removeShare(target, s.id)).shares)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const changeVis = async (v: DriveVisibility) => {
    const prev = vis
    setVis(v)
    try {
      await onVisibility?.(v)
    } catch (e: any) {
      setVis(prev)
      toast.error(e.message)
    }
  }

  const taken = new Set((shares ?? []).map(s => (s.role ? `role:${s.role}` : `admin:${s.adminId}`)))
  const options = [
    ...(people?.roles ?? []).map(r => ({ value: `role:${r}`, label: `Everyone who is ${roleLabel(r)}`, group: 'Roles' })),
    ...(people?.admins ?? []).map(a => ({ value: `admin:${a.id}`, label: a.name || a.email || 'Staff member', hint: a.name ? (a.email ?? undefined) : undefined, group: 'People' })),
  ].filter(o => !taken.has(o.value))

  return (
    <Dialog open onClose={onClose} size="md" zIndex="z-[1100]" title={`Share “${name}”`} description="Only staff can be given access. Files stay private: links are signed and expire after a few minutes.">
      <div className="space-y-5">
        {vis && onVisibility && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">General access</p>
            <AdminSelect
              value={vis}
              onChange={v => changeVis(v as DriveVisibility)}
              options={(['private', 'team', 'shared'] as const).map(v => ({ value: v, label: v === 'private' ? 'Private' : v === 'team' ? 'Whole team' : 'Shared', hint: VISIBILITY_LABEL[v] }))}
            />
          </div>
        )}

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">Add people or roles</p>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-[12rem] flex-1">
              <AdminSelect value={who} onChange={setWho} placeholder={people ? 'Choose a person or role' : 'Loading…'} options={options} />
            </div>
            <div className="w-36">
              <AdminSelect value={level} onChange={v => setLevel(v as DriveLevel)} options={LEVELS} />
            </div>
            <button type="button" disabled={!who || busy} onClick={add} className="control-md bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50">
              Share
            </button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">People with access</p>
          {!shares ? (
            <Loader2 className="h-5 w-5 animate-spin text-foreground-muted" />
          ) : !shares.length ? (
            <p className="text-sm text-foreground-secondary">Not shared with anyone yet.</p>
          ) : (
            <ul className="divide-y divide-border-default rounded-lg border border-border-default">
              {shares.map(s => (
                <li key={s.id} className="flex items-center gap-2.5 px-3 py-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-foreground-muted">
                    {s.role ? <Users className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.role ? `Role: ${roleLabel(s.role)}` : (s.adminName ?? 'Staff member')}</span>
                  <span className="flex items-center gap-1 text-xs text-foreground-secondary">
                    <Shield className="h-3 w-3" />
                    {LEVELS.find(l => l.value === s.level)?.label}
                  </span>
                  <button type="button" onClick={() => remove(s)} aria-label="Remove access" className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Dialog>
  )
}
