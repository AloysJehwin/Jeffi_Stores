'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, FileClock } from 'lucide-react'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useDraftLock } from '@/hooks/useDraftLock'
import { useDraftCounts, useDraftsList, type DraftListItem, type DraftsScope } from '@/hooks/useDraftsList'
import { timeAgo } from '@/lib/client/draft-lock-client'
import { DataTable, DraftLockBadge, HandoverDialog, TakeoverDialog, Tabs, useActionToast, useListSort, type DataCol } from '@/components/admin/kit'

// A list page's own drafts (one draft type), with claim / hand over / take over.
// Hidden while the type has none; collapsed until opened.

const SORT_NS = 'drafts'

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

/** Drafts of `type` on that type's list page. */
export default function PageDrafts({ type }: { type: string }) {
  const { counts, refresh: refreshCounts } = useDraftCounts(type)
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<DraftsScope>('all')
  if (!counts || counts.all + counts.unclaimed === 0) return null
  const tabs = [
    { id: 'mine' as const, label: `Mine (${counts.mine})` },
    { id: 'all' as const, label: `All locked (${counts.all})` },
    { id: 'unclaimed' as const, label: `Unclaimed (${counts.unclaimed})` },
  ]
  return (
    <section className="mb-4 rounded-xl border border-border-default bg-surface-elevated">
      <button type="button" aria-expanded={open} onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <FileClock className="h-4 w-4 text-accent-500" />
        <span className="text-sm font-semibold text-foreground">Drafts in progress</span>
        <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-xs text-foreground-secondary">{counts.all + counts.unclaimed}</span>
        {counts.mine > 0 && <span className="text-xs text-accent-500">{counts.mine} yours</span>}
        <ChevronDown className={`ml-auto h-4 w-4 text-foreground-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border-default px-4 py-3">
          <Tabs tabs={tabs} value={scope} onChange={setScope} />
          <DraftsTable type={type} scope={scope} onChanged={() => void refreshCounts()} />
        </div>
      )}
    </section>
  )
}

function DraftsTable({ type, scope, onChanged }: { type: string; scope: DraftsScope; onChanged: () => void }) {
  const { sort, dir } = useListSort(SORT_NS)
  const list = useDraftsList(scope, type, sort, dir)
  const refresh = () => {
    void list.refresh()
    onChanged()
  }
  const entity = (r: DraftListItem) => (
    <Link href={ap(r.editHref)} className="font-medium text-foreground hover:text-accent-500 hover:underline">
      {r.label}
    </Link>
  )
  const cols: DataCol<DraftListItem>[] = [
    { key: 'entity', label: 'Draft', sortParam: 'label', render: entity },
    { key: 'owner', label: 'Owner', sortParam: 'owner', render: r => <Owner r={r} /> },
    {
      key: 'started',
      label: 'Started',
      hideBelow: 'lg',
      sortParam: 'started',
      sortType: 'date',
      render: r => <span className="whitespace-nowrap text-foreground-secondary">{r.lock?.startedAt ? timeAgo(r.lock.startedAt) : '—'}</span>,
    },
    {
      key: 'active',
      label: 'Last active',
      sortParam: 'active',
      sortType: 'date',
      render: r => <span className="whitespace-nowrap text-foreground-secondary">{timeAgo(r.lock?.lastActiveAt ?? r.updatedAt) || '—'}</span>,
    },
    { key: 'viewers', label: 'Viewers', num: true, hideBelow: 'md', sortParam: 'viewers', render: r => <span className="text-foreground-secondary">{r.viewers || '—'}</span> },
    { key: 'actions', label: '', render: r => <RowLockActions r={r} onChanged={refresh} /> },
  ]

  return (
      <DataTable<DraftListItem>
        rows={list.rows}
        cols={cols}
        rowKey={rowKey}
        loading={list.loading}
        infinite={list.infinite}
        noun="drafts"
        sortNs={SORT_NS}
        bare
        mobileCard={r => (
          <div className="space-y-2 rounded-xl border border-border-default bg-surface-elevated px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {entity(r)}
                <p className="text-[11px] text-foreground-muted">active {timeAgo(r.lock?.lastActiveAt ?? r.updatedAt) || '—'}</p>
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
  )
}
