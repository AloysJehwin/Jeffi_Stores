'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useDraftLock } from '@/hooks/useDraftLock'
import { useDraftsList, type DraftListItem, type DraftsScope } from '@/hooks/useDraftsList'
import { timeAgo } from '@/lib/client/draft-lock-client'
import Select from '@/components/ui/Select'
import { DataTable, DraftLockBadge, HandoverDialog, TakeoverDialog, Tabs, useActionToast, type DataCol } from '@/components/admin/kit'

const TABS = [
  { id: 'mine', label: 'Mine' },
  { id: 'all', label: 'All locked' },
  { id: 'unclaimed', label: 'Unclaimed' },
] as const

const ghost =
  'control-sm inline-flex items-center border border-border-secondary bg-surface text-xs text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50'
const accent =
  'control-sm inline-flex items-center border border-accent-500/40 bg-accent-500/10 text-xs font-semibold text-accent-500 hover:bg-accent-500/20 disabled:opacity-50'

const rowKey = (r: DraftListItem) => `${r.resourceType}:${r.resourceId}:${r.lock?.epoch ?? 0}:${r.lock?.ownerId ?? ''}`

function Owner({ r }: { r: DraftListItem }) {
  const l = r.lock
  if (!l?.ownerId) return <span className="text-xs text-foreground-muted">Unclaimed</span>
  if (!l.ownerCanEdit) return <span className="text-xs text-foreground-muted">{l.ownerName ?? 'Admin'} (can no longer edit)</span>
  return <DraftLockBadge lock={l} mine={r.isMine} />
}

/** Claim / release / hand over / take over for one row. Its own lock state; no presence. */
function RowLockActions({ r, onChanged }: { r: DraftListItem; onChanged: () => void }) {
  const canWrite = useCanWrite(r.writeScope)
  const toast = useActionToast()
  const [dialog, setDialog] = useState<'handover' | 'takeover' | null>(null)
  const lock = useDraftLock({
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    presence: false,
    initial: { lock: r.lock, draftExists: true, isMine: r.isMine, canEdit: r.canEdit, canTakeOver: r.canTakeOver, canDiscard: false },
  })
  if (!canWrite) return null
  const done = (ok: boolean) => {
    if (ok) onChanged()
    return ok
  }
  // The dialogs act through this copy so a handover / takeover also refreshes the list.
  const dialogLock = {
    ...lock,
    handover: async (to: string) => done(await lock.handover(to)),
    takeover: async (reason: string) => done(await lock.takeover(reason)),
  }
  const buttons: ReactNode[] = []
  if (lock.isMine) {
    buttons.push(
      <button key="handover" type="button" className={ghost} disabled={lock.busy} onClick={() => setDialog('handover')}>
        Hand over
      </button>,
      <button key="release" type="button" className={ghost} disabled={lock.busy} onClick={async () => done(await lock.release())}>
        Release
      </button>
    )
  } else if (lock.claimable) {
    buttons.push(
      <button
        key="claim"
        type="button"
        className={accent}
        disabled={lock.busy}
        onClick={async () => {
          if (done(await lock.claim())) toast.success('You now hold this draft')
        }}
      >
        Claim
      </button>
    )
  } else if (lock.lock?.ownerId && !lock.closed) {
    if (lock.canTakeOver)
      buttons.push(
        <button key="takeover" type="button" className={accent} disabled={lock.busy} onClick={() => setDialog('takeover')}>
          Take over
        </button>
      )
    else
      buttons.push(
        <button key="request" type="button" className={ghost} disabled={lock.busy} onClick={() => void lock.requestAccess()}>
          Request access
        </button>
      )
  }
  if (!buttons.length) return null
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {buttons}
      <HandoverDialog lock={dialogLock} open={dialog === 'handover'} onClose={() => setDialog(null)} />
      <TakeoverDialog lock={dialogLock} open={dialog === 'takeover'} onClose={() => setDialog(null)} />
    </div>
  )
}

export default function DraftsClient({ initialScope }: { initialScope: DraftsScope }) {
  const [scope, setScope] = useState<DraftsScope>(initialScope)
  const [type, setType] = useState('')
  const list = useDraftsList(scope, type)
  const refresh = () => void list.refresh()

  const entity = (r: DraftListItem) => (
    <Link href={ap(r.editHref)} className="font-medium text-foreground hover:text-accent-500 hover:underline">
      {r.label}
    </Link>
  )
  const cols: DataCol<DraftListItem>[] = [
    { key: 'entity', label: 'Draft', sort: r => r.label.toLowerCase(), render: entity },
    { key: 'type', label: 'Type', sort: r => r.typeLabel, render: r => <span className="text-foreground-secondary">{r.typeLabel}</span> },
    { key: 'owner', label: 'Owner', sort: r => (r.lock?.ownerName ?? '').toLowerCase(), render: r => <Owner r={r} /> },
    {
      key: 'started',
      label: 'Started',
      hideBelow: 'lg',
      sort: r => r.lock?.startedAt ?? '',
      render: r => <span className="whitespace-nowrap text-foreground-secondary">{r.lock?.startedAt ? timeAgo(r.lock.startedAt) : '—'}</span>,
    },
    {
      key: 'active',
      label: 'Last active',
      sort: r => r.lock?.lastActiveAt ?? r.updatedAt ?? '',
      render: r => <span className="whitespace-nowrap text-foreground-secondary">{timeAgo(r.lock?.lastActiveAt ?? r.updatedAt) || '—'}</span>,
    },
    { key: 'viewers', label: 'Viewers', num: true, hideBelow: 'md', sort: r => r.viewers, render: r => <span className="text-foreground-secondary">{r.viewers || '—'}</span> },
    { key: 'actions', label: '', render: r => <RowLockActions r={r} onChanged={refresh} /> },
  ]

  return (
    <div className="space-y-4">
      <Tabs tabs={TABS} value={scope} onChange={setScope} />
      <DataTable<DraftListItem>
        rows={list.rows}
        cols={cols}
        rowKey={rowKey}
        loading={list.loading}
        infinite={list.infinite}
        noun="drafts"
        search={{ placeholder: 'Search drafts...', match: r => `${r.label} ${r.typeLabel} ${r.lock?.ownerName ?? ''}` }}
        toolbar={
          <div className="w-48">
            <Select
              value={type}
              onChange={setType}
              aria-label="Draft type"
              options={[{ value: '', label: 'All types' }, ...list.types]}
            />
          </div>
        }
        mobileCard={r => (
          <div className="space-y-2 rounded-xl border border-border-default bg-surface-elevated px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {entity(r)}
                <p className="text-[11px] text-foreground-muted">
                  {r.typeLabel} · active {timeAgo(r.lock?.lastActiveAt ?? r.updatedAt) || '—'}
                </p>
              </div>
              <Owner r={r} />
            </div>
            <RowLockActions r={r} onChanged={refresh} />
          </div>
        )}
        empty={
          scope === 'mine'
            ? { title: 'You are not editing any drafts.', body: 'Drafts you start or claim show up here until they are published or discarded.' }
            : scope === 'all'
              ? { title: 'No one is editing a draft right now.' }
              : { title: 'No unclaimed drafts.', body: 'A released draft, or one nobody has opened since locks began, shows up here.' }
        }
      />
    </div>
  )
}
