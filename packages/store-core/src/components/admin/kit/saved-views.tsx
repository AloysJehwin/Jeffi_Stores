'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  Bookmark,
  BookmarkPlus,
  Download,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Share2,
  Trash2,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { canonicalQuery, toParams, type FilterField, type ParamSource } from '@jeffi/list-filters/client'
import IconButton from '@/components/ui/IconButton'
import { useConfirm, usePrompt } from '@/contexts/ConfirmContext'
import { portalRoot } from '@/lib/shared/portal-root'
import { api } from './core'
import { useActionToast } from './toast'

// The saved-views menu, share link and CSV export on a ListFilters toolbar. Views live in the DB
// per admin (/api/admin/saved-views); links and views carry the list's canonical query plus sort.

interface ListRef {
  /** Registry key. */
  entity: string
  fields: FilterField[]
  search?: string | false
  /** The tab a link or view opens on when the URL has none. */
  tab?: string
}

interface View {
  id: string
  name: string
  query: string
  isShared: boolean
  mine: boolean
  ownerName: string | null
}

/** The list's own filters and sort from a URL: what a view stores and a link carries. */
export function viewQueryOf(sp: ParamSource, fields: FilterField[], search?: string | false): string {
  const out = new URLSearchParams(canonicalQuery(sp, fields, { search }))
  const src = toParams(sp)
  const sort = src.get('sort')
  if (sort) {
    out.set('sort', sort)
    const dir = src.get('dir')
    if (dir) out.set('dir', dir)
  }
  return out.toString()
}

/** `?tab=…&<query>`: the current (or pinned) tab first, then the view's filters. */
function withTab(query: string, tab: string | null | undefined): string {
  const p = new URLSearchParams(tab ? { tab } : {})
  new URLSearchParams(query).forEach((v, k) => p.append(k, v))
  return p.toString()
}

const absolute = (qs: string) => `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ''}`

const btnCls = (on: boolean) =>
  `control-md shrink-0 border px-2.5 md:px-4 ${on ? 'border-accent-500/50 bg-accent-500/5 text-accent-600' : 'border-border-default text-foreground-secondary hover:bg-surface-secondary'}`

/** A toolbar button with a panel portalled out of the toolbar's scroll box, right-aligned under it. */
function Popover({
  icon: Icon,
  label,
  active,
  open,
  setOpen,
  children,
}: {
  icon: LucideIcon
  label: ReactNode
  active?: boolean
  open: boolean
  setOpen: (o: boolean) => void
  children: ReactNode
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = trigger.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!trigger.current?.contains(t) && !panel.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, setOpen])

  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen(!open)} aria-expanded={open} className={btnCls(!!active || open)}>
        <Icon className="h-4 w-4" />
        <span className="hidden max-w-[10rem] truncate md:inline">{label}</span>
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={panel}
            style={{ position: 'fixed', top: pos.top, right: pos.right }}
            className="z-[900] w-80 max-w-[calc(100vw-1rem)] rounded-xl border border-border-default bg-surface-elevated p-2 shadow-lg"
          >
            {children}
          </div>,
          portalRoot()
        )}
    </>
  )
}

export function SavedViewsMenu({ entity, fields, search, tab }: ListRef) {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const toast = useActionToast()
  const confirm = useConfirm()
  const prompt = usePrompt()
  const [open, setOpen] = useState(false)
  const [views, setViews] = useState<View[] | null>(null)
  const [canShare, setCanShare] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const current = viewQueryOf(sp, fields, search)
  const keyOf = (q: string) => viewQueryOf(new URLSearchParams(q), fields, search)
  const activeView = current ? views?.find(v => keyOf(v.query) === current) : undefined
  const currentTab = sp.get('tab') || tab

  // Loaded with the page so the button can name the active view; a failure just shows none.
  const load = useCallback(async () => {
    const r = await api<{ views: View[]; canShare: boolean }>(`/api/admin/saved-views?page=${encodeURIComponent(entity)}`).catch(
      () => ({ ok: false, data: { views: [], canShare: false } })
    )
    setViews(r.ok ? r.data.views : [])
    setCanShare(r.ok && r.data.canShare)
  }, [entity])

  useEffect(() => {
    if (views === null) load()
  }, [views, load])

  const run = async (key: string, fn: () => Promise<{ ok: boolean; data: { error?: string } }>, ok?: string) => {
    setBusy(key)
    try {
      const r = await fn().catch(() => ({ ok: false, data: { error: 'Network error' } }))
      if (!r.ok) toast.error(r.data.error || 'Something went wrong.')
      else {
        if (ok) toast.success(ok)
        await load()
      }
    } finally {
      setBusy(null)
    }
  }

  const save = async () => {
    setOpen(false)
    const name = await prompt({ title: 'Save view', message: 'Name this set of filters.', placeholder: 'e.g. COD to ship', confirmLabel: 'Save' })
    if (name) await run('new', () => api('/api/admin/saved-views', { method: 'POST', json: { page: entity, name, query: current } }), `Saved "${name}"`)
  }
  const rename = async (v: View) => {
    setOpen(false)
    const name = await prompt({ title: 'Rename view', message: 'New name', defaultValue: v.name, confirmLabel: 'Rename' })
    if (name && name !== v.name) await run(v.id, () => api(`/api/admin/saved-views/${v.id}`, { method: 'PATCH', json: { name } }))
  }
  const patch = (v: View, json: Record<string, unknown>, ok: string) =>
    run(v.id, () => api(`/api/admin/saved-views/${v.id}`, { method: 'PATCH', json }), ok)
  const remove = async (v: View) => {
    setOpen(false)
    if (await confirm({ title: 'Delete view', message: `Delete "${v.name}"?`, confirmLabel: 'Delete', variant: 'danger' })) {
      await run(v.id, () => api(`/api/admin/saved-views/${v.id}`, { method: 'DELETE' }), 'View deleted')
    }
  }
  const apply = (v: View) => {
    setOpen(false)
    router.push(`${pathname}?${withTab(v.query, currentTab)}`)
  }
  const copy = async (v: View) => {
    const ok = await navigator.clipboard?.writeText(absolute(withTab(v.query, currentTab))).then(
      () => true,
      () => false
    )
    toast[ok ? 'success' : 'error'](ok ? 'Link copied' : 'Could not copy the link')
  }

  const mine = views?.filter(v => v.mine) ?? []
  const shared = views?.filter(v => !v.mine) ?? []
  const row = (v: View) => {
    const on = v.id === activeView?.id
    return (
      <li key={v.id} className={`flex items-center gap-1 rounded-lg pl-2 ${on ? 'bg-accent-500/10' : 'hover:bg-surface-secondary'}`}>
        <button type="button" onClick={() => apply(v)} className="min-w-0 flex-1 py-1.5 text-left text-sm">
          <span className={`block truncate ${on ? 'font-semibold text-accent-600' : 'text-foreground'}`}>{v.name}</span>
          {!v.mine && v.ownerName && <span className="block truncate text-[11px] text-foreground-muted">by {v.ownerName}</span>}
          {v.mine && v.isShared && <span className="block text-[11px] text-foreground-muted">Shared with the team</span>}
        </button>
        {busy === v.id ? (
          <Loader2 className="mx-2 h-4 w-4 animate-spin text-foreground-muted" />
        ) : (
          <span className="flex shrink-0 items-center">
            {v.mine && current && !on && (v.isShared ? canShare : true) && (
              <IconButton size="sm" icon={RefreshCw} label="Update to current filters" onClick={() => patch(v, { query: current }, 'View updated')} />
            )}
            {v.mine && (v.isShared ? canShare : true) && <IconButton size="sm" icon={Pencil} label="Rename" onClick={() => rename(v)} />}
            {v.mine && (canShare || v.isShared) && (
              <IconButton
                size="sm"
                icon={Users}
                variant={v.isShared ? 'accent' : 'default'}
                label={v.isShared ? 'Stop sharing' : 'Share with the team'}
                onClick={() => patch(v, { isShared: !v.isShared }, v.isShared ? 'No longer shared' : 'Shared with the team')}
              />
            )}
            <IconButton size="sm" icon={Link2} label="Copy link" onClick={() => copy(v)} />
            {v.mine && <IconButton size="sm" icon={Trash2} variant="danger" label="Delete" onClick={() => remove(v)} />}
          </span>
        )}
      </li>
    )
  }

  return (
    <Popover icon={Bookmark} label={activeView?.name ?? 'Views'} active={!!activeView} open={open} setOpen={setOpen}>
      <button
        type="button"
        onClick={save}
        disabled={!current || busy === 'new'}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-accent-600 hover:bg-surface-secondary disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <BookmarkPlus className="h-4 w-4" />
        Save current filters as a view
      </button>
      {views === null ? (
        <p className="px-2 py-3 text-xs text-foreground-muted">Loading…</p>
      ) : !views.length ? (
        <p className="px-2 py-3 text-xs text-foreground-muted">No saved views yet. Set filters, then save them here.</p>
      ) : (
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {mine.length > 0 && (
            <div>
              <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">My views</p>
              <ul>{mine.map(row)}</ul>
            </div>
          )}
          {shared.length > 0 && (
            <div>
              <p className="px-2 pt-2 text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Shared</p>
              <ul>{shared.map(row)}</ul>
            </div>
          )}
        </div>
      )}
    </Popover>
  )
}

/** One tap: the page's link with these filters (tab kept). The share sheet on touch devices, else the clipboard. */
export function ShareFilterLink({ fields, search, tab }: Omit<ListRef, 'entity'>) {
  const sp = useSearchParams()
  const toast = useActionToast()
  const share = async () => {
    const url = absolute(withTab(viewQueryOf(sp, fields, search), sp.get('tab') || tab))
    if (navigator.maxTouchPoints > 0 && typeof navigator.share === 'function') {
      try {
        await navigator.share({ url, title: document.title })
        return
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
      }
    }
    const ok = await navigator.clipboard?.writeText(url).then(
      () => true,
      () => false
    )
    toast[ok ? 'success' : 'error'](ok ? 'Link to these filters copied' : 'Could not copy the link')
  }
  return (
    <button type="button" onClick={share} className={btnCls(false)} aria-label="Share these filters">
      <Share2 className="h-4 w-4" />
      <span className="hidden md:inline">Share</span>
    </button>
  )
}

/** CSV of exactly the filtered rows: counts them first, warns at the cap, then downloads. */
export function ExportRowsButton({ entity, fields, search, noun = 'rows' }: ListRef & { noun?: string }) {
  const sp = useSearchParams()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState<{ q: string; count: number; capped: boolean; cap: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const q = canonicalQuery(sp, fields, { search })
  const url = `/api/admin/filters/${entity}/export${q ? `?${q}` : ''}`

  useEffect(() => {
    if (!open || count?.q === q) return
    let live = true
    setError(null)
    api<{ count: number; capped: boolean; cap: number }>(`${url}${q ? '&' : '?'}count=1`)
      .then(r => {
        if (!live) return
        if (r.ok) setCount({ q, count: r.data.count, capped: r.data.capped, cap: r.data.cap })
        else setError(r.data.error || 'Could not count the rows')
      })
      .catch(() => live && setError('Could not count the rows'))
    return () => {
      live = false
    }
  }, [open, q, url, count?.q])

  const ready = count?.q === q ? count : null
  const label = noun.toLowerCase()
  return (
    <Popover icon={Download} label="Export" open={open} setOpen={setOpen}>
      <div className="space-y-2 p-2 text-sm">
        {error ? (
          <p className="text-red-600 dark:text-red-400">{error}</p>
        ) : !ready ? (
          <p className="flex items-center gap-2 text-foreground-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            Counting {label}…
          </p>
        ) : (
          <>
            <p className="text-foreground">
              {ready.count ? `${ready.count.toLocaleString('en-IN')} ${label} match these filters.` : `No ${label} match these filters.`}
            </p>
            {ready.capped && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Only the first {ready.cap.toLocaleString('en-IN')} are exported. Narrow the filters to get the rest.
              </p>
            )}
            <button
              type="button"
              disabled={!ready.count}
              onClick={() => {
                setOpen(false)
                window.location.href = url
              }}
              className="control-md w-full bg-accent-500 font-medium text-white hover:bg-accent-600 disabled:opacity-40"
            >
              <Download className="h-4 w-4" />
              Export {ready.count.toLocaleString('en-IN')} {label} (CSV)
            </button>
          </>
        )}
      </div>
    </Popover>
  )
}
