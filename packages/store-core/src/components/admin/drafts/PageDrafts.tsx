'use client'

import { useState, type ReactNode } from 'react'
import { FileClock, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useDraftLock } from '@/hooks/useDraftLock'
import { useDraftCounts, useDraftsList, type DraftListItem, type DraftsScope } from '@/hooks/useDraftsList'
import { timeAgo } from '@/lib/client/draft-lock-client'
import { DataTable, DraftLockBadge, HandoverDialog, TakeoverDialog, Tabs, useActionToast, useListSort, type DataCol } from '@/components/admin/kit'

// A list page's Drafts tab (one draft type, or a comma list with a Type column), with claim / hand over / take over / request / delete.

const SORT_NS = 'drafts'

const ghost =
  'control-sm inline-flex items-center border border-border-secondary bg-surface text-xs text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50'
const accent =
  'control-sm inline-flex items-center border border-accent-500/40 bg-accent-500/10 text-xs font-semibold text-accent-500 hover:bg-accent-500/20 disabled:opacity-50'
const danger =
  'control-sm inline-flex items-center gap-1 border border-red-500/40 text-xs text-red-600 dark:text-red-400 hover:bg-red-500/10 disabled:opacity-50'

// Types where the whole entity is the draft: deleting removes it, not an edit of something live.
const WHOLE: Record<string, string> = {
  mailer: 'This draft message will be deleted.',
  invoice: 'This draft invoice will be deleted.',
  quotation: 'This draft quotation will be deleted.',
  purchase_order: 'This draft purchase order will be cancelled.',
  po_new: 'This new purchase order will be deleted.',
  po_receive: 'This receipt draft will be deleted; nothing has been received from it.',
  cash_sale: 'This held bill will be deleted.',
  scenario: 'This new scenario will be deleted.',
  google_ads_campaign: 'This new campaign will be deleted.',
  rfq_reply: 'This unsent reply will be deleted.',
}
// Catalog types: a never-published entity is its own draft (its edit link has no ?draft=).
const CATALOG = new Set(['product', 'brand', 'category', 'coupon', 'review_form'])

function deleteMessage(r: DraftListItem, holder: string | null): string {
  const what =
    WHOLE[r.resourceType] ??
    (CATALOG.has(r.resourceType) && !r.editHref.includes('draft=')
      ? `This new ${r.typeLabel.toLowerCase()} was never published; it will be deleted.`
      : "Changes in it are lost; the published version isn't affected.")
  return holder ? `${holder} is editing this draft — they'll be notified.\n\n${what}` : what
}

const rowKey = (r: DraftListItem) => `${r.resourceType}:${r.resourceId}:${r.lock?.epoch ?? 0}:${r.lock?.ownerId ?? ''}`

function Owner({ r }: { r: DraftListItem }) {
  const l = r.lock
  if (!l?.ownerId) return <span className="text-xs text-foreground-muted">Unclaimed</span>
  if (!l.ownerCanEdit) return <span className="text-xs text-foreground-muted">{l.ownerName ?? 'Admin'} (can no longer edit)</span>
  return <DraftLockBadge lock={l} mine={r.isMine} />
}

/** Claim / release / hand over / take over / delete for one row. Its own lock state; no presence. */
function RowLockActions({ r, onChanged }: { r: DraftListItem; onChanged: () => void }) {
  const canWrite = useCanWrite(r.writeScope)
  const toast = useActionToast()
  const confirm = useConfirm()
  const [dialog, setDialog] = useState<'handover' | 'takeover' | null>(null)
  const lock = useDraftLock({
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    presence: false,
    initial: { lock: r.lock, draftExists: true, isMine: r.isMine, canEdit: r.canEdit, canTakeOver: r.canTakeOver, canDiscard: r.canDiscard },
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
  if (lock.canDiscard && !lock.closed) {
    const l = lock.lock
    const holder = l?.ownerId && l.ownerCanEdit && !lock.isMine ? (l.ownerName ?? 'Another admin') : null
    buttons.push(
      <button
        key="delete"
        type="button"
        className={danger}
        disabled={lock.busy}
        onClick={async () => {
          const cancel = r.resourceType === 'purchase_order'
          const ok = await confirm({
            title: cancel ? 'Cancel this purchase order?' : 'Delete this draft?',
            message: deleteMessage(r, holder),
            confirmLabel: cancel ? 'Cancel PO' : 'Delete',
            cancelLabel: 'Keep',
            variant: 'danger',
          })
          if (ok) done(await lock.discard())
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
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

/** Tab label for a list page's Drafts tab, with a live count. `count` replaces it when the tab lists more than edit-drafts. */
export function DraftsTabLabel({ type, label = 'Drafts', count }: { type: string; label?: string; count?: number }) {
  const { counts } = useDraftCounts(type)
  const n = count ?? (counts ? counts.all + counts.unclaimed : 0)
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {n > 0 && <span className="rounded-full bg-accent-500/15 px-1.5 text-[11px] font-semibold text-accent-500">{n}</span>}
    </span>
  )
}

/** Body of a list page's Drafts tab: `children` (publish / discard rows) above the lock table. */
export default function PageDrafts({ type, children }: { type: string; children?: ReactNode }) {
  const { counts, refresh: refreshCounts } = useDraftCounts(type)
  const [scope, setScope] = useState<DraftsScope>('all')
  const tabs = [
    { id: 'all' as const, label: `In progress (${counts?.all ?? 0})` },
    { id: 'mine' as const, label: `Mine (${counts?.mine ?? 0})` },
    { id: 'unclaimed' as const, label: `Unclaimed (${counts?.unclaimed ?? 0})` },
  ]
  return (
    <div className="space-y-4">
      {children}
      <section className="space-y-3 rounded-xl border border-border-default bg-surface-elevated px-4 py-3">
        <div className="flex items-center gap-2">
          <FileClock className="h-4 w-4 text-accent-500" />
          <span className="text-sm font-semibold text-foreground">Who is editing</span>
        </div>
        <Tabs tabs={tabs} value={scope} onChange={setScope} />
        <DraftsTable type={type} scope={scope} onChanged={() => void refreshCounts()} />
      </section>
    </div>
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
    ...(type.includes(',')
      ? [{ key: 'type', label: 'Type', hideBelow: 'md' as const, render: (r: DraftListItem) => <span className="text-foreground-secondary">{r.typeLabel}</span> }]
      : []),
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
