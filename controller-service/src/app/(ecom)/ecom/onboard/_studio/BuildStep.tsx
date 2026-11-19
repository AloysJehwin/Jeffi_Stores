'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertCircle, ArrowLeft, Check, Circle, Copy, Eye, EyeOff, GripVertical, ImageIcon, Loader2, MousePointerClick, Paintbrush, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import CodeContentFields from '@/components/admin/site-builder/CodeContentFields'
import type { CodeLiteral, LiteralEdit } from '@/lib/site/code/literals'
import { fieldInput, ghostBtn, noteCls, primaryBtn, secondaryBtn } from '../ui'
import { AI_UNAVAILABLE, isAiDown, isPriceChanged, isWalletLow, StudioError, studioGet, studioPost, studioStream, studioUrl, WALLET_LOW, type StudioView } from './api'
import StudioPreview, { DeviceToggle, type Device, type PickedSection } from './StudioPreview'
import type { StudioEvent } from '@/lib/site/studio/types'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'

// The live build and, once built, the preview with tweaks. Pages stream in one by one (home first) and the preview
// follows the latest finished page until the owner picks one. Picking a section and saying what to change rewrites
// that section; "Design this page again" rebuilds the whole page. Beside the preview, the page's sections: drag to
// reorder (or drag a section's handle in the preview), copy, hide or delete, and edit a section's words, links and
// pictures. Those edits are free and wait while a build runs.

type PageState = 'waiting' | 'building' | 'done' | 'failed'
const CHROME = new Set(['store:header', 'store:footer', 'store:announcement'])
// Free retries per page that failed in the free generation (the server's FREE_RETRIES).
const FREE_RETRIES = 2

interface ListPage {
  key: string
  label: string
  themed: boolean
  chrome: boolean
}

type OutlineSection = { id: string; label: string; hidden?: boolean }
type EditView = StudioView & { literals?: CodeLiteral[] }
const PREVIEW_FRAME = 'iframe[src*="/onboard/studio/preview/"]'
const previewWindow = () => document.querySelector<HTMLIFrameElement>(PREVIEW_FRAME)?.contentWindow ?? null

function SectionRow({
  section,
  selected,
  disabled,
  only,
  onSelect,
  onHide,
  onDuplicate,
  onDelete,
}: {
  section: OutlineSection
  selected: boolean
  disabled: boolean
  /** The page's last shown section: it can't be hidden or deleted. */
  only: boolean
  onSelect: () => void
  onHide: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: section.id, disabled })
  const icon = 'ecom-focus shrink-0 rounded-full p-1 text-foreground-muted ecom-hover hover:text-foreground disabled:opacity-30'
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`flex items-center gap-1 rounded-xl border px-1.5 py-1 text-sm ${
        isDragging ? 'border-dashed ecom-current' : selected ? 'ecom-current border-border-default font-semibold' : 'border-border-default bg-surface-elevated'
      } ${section.hidden && !isDragging ? 'opacity-60' : ''}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Drag to move ${section.label}`}
        title="Drag to move (or focus and use Space, then the arrow keys)"
        className="ecom-focus shrink-0 cursor-grab touch-none rounded-full p-1 text-foreground-muted disabled:cursor-default disabled:opacity-30"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onSelect} className="ecom-focus min-w-0 flex-1 truncate rounded-lg px-1 py-1 text-left text-foreground">
        {section.label}
      </button>
      <button type="button" onClick={onHide} disabled={disabled || (only && !section.hidden)} className={icon} aria-label={section.hidden ? `Show ${section.label}` : `Hide ${section.label}`} title={section.hidden ? 'Show' : 'Hide'}>
        {section.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
      <button type="button" onClick={onDuplicate} disabled={disabled} className={icon} aria-label={`Copy ${section.label}`} title="Copy">
        <Copy className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onDelete} disabled={disabled || only} className={`${icon} hover:text-red-600`} aria-label={`Delete ${section.label}`} title="Delete">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </li>
  )
}

/** The page's sections, sortable with the pointer or the keyboard. */
function SectionList({
  sections,
  disabled,
  picked,
  onSelect,
  onMove,
  onHide,
  onDuplicate,
  onDelete,
}: {
  sections: OutlineSection[]
  disabled: boolean
  picked: string | null
  onSelect: (s: OutlineSection) => void
  onMove: (id: string, before: string | null, order: string[]) => void
  onHide: (s: OutlineSection) => void
  onDuplicate: (s: OutlineSection) => void
  onDelete: (s: OutlineSection) => void
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const [active, setActive] = useState<string | null>(null)
  const ids = sections.map(x => x.id)
  const shown = sections.filter(x => !x.hidden).length
  return (
    <DndContext
      id="studio-sections"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={e => setActive(String(e.active.id))}
      onDragCancel={() => setActive(null)}
      onDragEnd={e => {
        setActive(null)
        const { active: a, over } = e
        if (!over || a.id === over.id) return
        const to = ids.indexOf(String(over.id))
        const next = arrayMove(ids, ids.indexOf(String(a.id)), to)
        onMove(String(a.id), next[to + 1] ?? null, next)
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="space-y-1.5">
          {sections.map(x => (
            <SectionRow
              key={x.id}
              section={x}
              selected={picked === x.id}
              disabled={disabled}
              only={sections.length <= 1 || (!x.hidden && shown <= 1)}
              onSelect={() => onSelect(x)}
              onHide={() => onHide(x)}
              onDuplicate={() => onDuplicate(x)}
              onDelete={() => onDelete(x)}
            />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {active ? <div className="rounded-xl border border-border-default bg-surface-elevated px-3 py-2 text-sm font-semibold text-foreground shadow-lg">{sections.find(x => x.id === active)?.label ?? 'Section'}</div> : null}
      </DragOverlay>
    </DndContext>
  )
}

export default function BuildStep({
  view,
  onView,
  autoStart,
  onBack,
  onAiDown,
  onWalletLow,
  aiDown = false,
}: {
  view: StudioView
  onView: (v: StudioView) => void
  autoStart: boolean
  onBack: () => void
  /** Claude became unreachable: the studio shows its notice instead of an error toast. */
  onAiDown?: () => void
  /** A paid generation (a Showcase's after its free one) the wallet can't cover: the studio shows where to top up. */
  onWalletLow?: (e: StudioError) => void
  /** While Claude is unreachable the preview stays, without the AI actions. */
  aiDown?: boolean
}) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const refresh = useCallback(async () => {
    const v = await studioGet().catch(() => null)
    if (v) onView(v)
    return v
  }, [onView])
  const report = useCallback(
    (e: unknown) => {
      if (isWalletLow(e) && onWalletLow) return onWalletLow(e)
      if (isAiDown(e) && onAiDown) return onAiDown()
      showToast((e as Error).message, 'error')
      // The price shown was out of date: load the current one, so the next try asks with it.
      if (isPriceChanged(e)) void refresh()
    },
    [onAiDown, onWalletLow, showToast, refresh]
  )
  const s = view.session!
  const plan = s.plan!
  // A Showcase has one page; each design after the free one is a redesign for `paid.priceInr` from the wallet.
  const showcase = s.product === 'showcase'
  const home = showcase ? SHOWCASE_PAGE_KEY : 'store:home'
  const paid = view.allowance.paid
  const charged = useCallback((inr: unknown) => {
    if (Number(inr) > 0) showToast(`Your new page is ready. ₹${Number(inr)} was charged to your wallet.`, 'success')
  }, [showToast])
  const [live, setLive] = useState<Record<string, PageState>>({})
  const [section, setSection] = useState<Record<string, { index: number; total: number; label: string }>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [current, setCurrent] = useState<string>(home)
  const follow = useRef(true)
  const [device, setDevice] = useState<Device>('desktop')
  const [version, setVersion] = useState(0)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<PickedSection | null>(null)
  const [instruction, setInstruction] = useState('')
  const [working, setWorking] = useState<'tweak' | 'rebuild' | 'retry' | 'pictures' | null>(null)
  const started = useRef(false)
  // A hand edit saving (move, copy, hide, delete, words); the order shown while a move saves.
  const [editing, setEditing] = useState(false)
  const [order, setOrder] = useState<{ page: string; ids: string[] } | null>(null)
  const [literals, setLiterals] = useState<CodeLiteral[] | null>(null)

  useEffect(() => {
    if (window.matchMedia('(max-width: 639px)').matches) setDevice('phone')
  }, [])

  const pages: ListPage[] = useMemo(
    () => [
      ...plan.pages.filter(p => p.enabled).map(p => ({ key: p.key, label: p.audience === 'business' && !p.label.toLowerCase().includes('business') ? `Business ${p.label.toLowerCase()}` : p.label, themed: false, chrome: CHROME.has(p.key) })),
      ...plan.themed.filter(t => !t.sharedWith).map(t => ({ key: `${t.audience}:${t.key}`, label: t.audience === 'business' ? `Business ${t.label.toLowerCase()}` : t.label, themed: true, chrome: false })),
    ],
    [plan]
  )
  const failedSaved = new Set(s.progress?.failed ?? [])
  const stateOf = (key: string): PageState => live[key] ?? (s.pages[key] ? 'done' : failedSaved.has(key) ? 'failed' : 'waiting')
  const building = streaming || s.status === 'building'
  const built = pages.filter(p => !p.themed && stateOf(p.key) === 'done').length
  const total = pages.filter(p => !p.themed).length
  const homeReady = stateOf(home) === 'done'
  const currentPage = pages.find(p => p.key === current)
  const canTweak = !building && !!currentPage && !currentPage.themed && stateOf(current) === 'done'
  const retriesOf = (key: string) => s.progress?.retries?.[key] ?? 0
  const failedPages = pages.filter(p => !p.themed && stateOf(p.key) === 'failed')
  const retryable = failedPages.filter(p => retriesOf(p.key) < FREE_RETRIES)
  const resumable = s.status === 'failed' && view.allowance.free === 'resume'

  const show = (key: string) => {
    setCurrent(key)
    setPicked(null)
  }

  const onEvent = useCallback(
    (event: string, data: any) => {
      if (event === 'start') setLive(Object.fromEntries((data.done as string[]).map(k => [k, 'done' as PageState])))
      else if (event === 'status') setMessage(data.message)
      else if (event === 'page') {
        setLive(l => ({ ...l, [data.key]: 'building' }))
        setMessage(`Designing ${data.label}`)
      } else if (event === 'progress') {
        const e = data as StudioEvent
        if (e.type === 'section') setSection(x => ({ ...x, [e.page]: { index: e.index, total: e.total, label: e.label } }))
      } else if (event === 'page-done') {
        setLive(l => ({ ...l, [data.key]: 'done' }))
        setVersion(n => n + 1)
        if (!CHROME.has(data.key) && follow.current) setCurrent(data.key)
        charged(data.chargedInr)
      } else if (event === 'page-failed') {
        setLive(l => ({ ...l, [data.key]: 'failed' }))
        if (data.error) setMessage(data.error)
      } else if (event === 'catalog') setVersion(n => n + 1)
      else if (event === 'done') onView(data as StudioView)
      else if (event === 'error') {
        if (data.code === AI_UNAVAILABLE && onAiDown) onAiDown()
        else if (data.code === WALLET_LOW && onWalletLow) onWalletLow(new StudioError(data.error, 402, data.code, data))
        else showToast(data.error || 'The build stopped', 'error')
      }
    },
    [onView, showToast, onAiDown, onWalletLow, charged]
  )

  const priceInr = paid?.priceInr ?? null
  const startBuild = useCallback(async () => {
    setStreaming(true)
    setMessage('Getting started')
    try {
      await studioStream('generate', priceInr !== null ? { expect: 'paid', priceInr } : {}, onEvent)
    } catch (e) {
      report(e)
    } finally {
      setStreaming(false)
      setMessage(null)
      setVersion(n => n + 1)
      await refresh()
    }
  }, [onEvent, refresh, report, priceInr])

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true
      void startBuild()
    }
  }, [autoStart, startBuild])

  // A build running from another tab or an earlier visit: follow it from the database.
  useEffect(() => {
    if (streaming || s.status !== 'building') return
    const t = setInterval(async () => {
      const v = await refresh()
      setVersion(n => n + 1)
      if (v?.session?.status !== 'building') clearInterval(t)
    }, 5000)
    return () => clearInterval(t)
  }, [streaming, s.status, refresh])

  async function tweak() {
    if (!picked || instruction.trim().length < 3) return
    setWorking('tweak')
    try {
      const v = await studioPost<StudioView>('tweak', { page: picked.page, blockId: picked.blockId, instruction: instruction.trim() })
      onView(v)
      setInstruction('')
      setVersion(n => n + 1)
      // The section's code changed: read its words and pictures again.
      setPicked(p => (p ? { ...p } : p))
      showToast(`Changed “${picked.label}”`, 'success')
    } catch (e) {
      report(e)
    } finally {
      setWorking(null)
    }
  }

  async function rebuild() {
    if (!currentPage || currentPage.themed) return
    const ask = paid
      ? { title: 'Design your page again?', message: `It costs ₹${paid.priceInr} from your wallet. If the new page can’t be made, you aren’t charged. Your current page stays until the new one is ready.`, confirmLabel: `Design again · ₹${paid.priceInr}` }
      : showcase
        ? { title: 'Design your page with AI?', message: 'This is your free design. Your current page stays until the new one is ready.', confirmLabel: 'Design my page' }
        : { title: `Design the ${currentPage.label} page again?`, message: 'It counts as 5 of today’s free changes.', confirmLabel: 'Design again' }
    if (!(await confirm(ask))) return
    setWorking('rebuild')
    setPicked(null)
    try {
      await studioStream('regenerate-page', { page: current, ...(paid ? { expect: 'paid', priceInr: paid.priceInr } : {}) }, (event, data) => {
        if (event === 'progress' && data.type === 'section') setMessage(`Writing ${data.label} (${data.index + 1} of ${data.total})`)
        else if (event === 'page-done') charged(data.chargedInr)
        else if (event === 'page-failed') showToast(data.error || 'That page could not be designed again', 'error')
        else if (event === 'error') onEvent(event, data)
        else if (event === 'done') onView(data as StudioView)
      })
    } catch (e) {
      report(e)
    } finally {
      setWorking(null)
      setMessage(null)
      setVersion(n => n + 1)
    }
  }

  // Failed pages tried again one by one, free (they don't count against the day's changes).
  async function retry(keys: string[]) {
    if (!keys.length) return
    setWorking('retry')
    setPicked(null)
    for (const key of keys) {
      setLive(l => ({ ...l, [key]: 'building' }))
      setMessage(`Trying ${pages.find(p => p.key === key)?.label ?? 'the page'} again`)
      let stop = false
      try {
        await studioStream('regenerate-page', { page: key, retry: true }, (event, data) => {
          if (event === 'progress' && data.type === 'section') setSection(x => ({ ...x, [key]: { index: data.index, total: data.total, label: data.label } }))
          else if (event === 'page-done') {
            setLive(l => ({ ...l, [key]: 'done' }))
            setVersion(n => n + 1)
            if (!CHROME.has(key)) setCurrent(key)
          } else if (event === 'page-failed') {
            setLive(l => ({ ...l, [key]: 'failed' }))
            showToast(data.error || 'That page could not be designed this time', 'error')
          } else if (event === 'done') onView(data as StudioView)
        })
      } catch (e) {
        setLive(l => ({ ...l, [key]: 'failed' }))
        report(e)
        stop = isAiDown(e) || /budget|retried twice/i.test((e as Error).message)
      }
      if (stop) break
    }
    setWorking(null)
    setMessage(null)
    setVersion(n => n + 1)
    await refresh()
  }

  // The product photos again, when the image service was down during the build.
  async function addPhotos() {
    setWorking('pictures')
    setMessage('Making product photos')
    try {
      onView(await studioPost<StudioView>('pictures', {}))
      showToast('Product photos added.', 'success')
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setWorking(null)
      setMessage(null)
      setVersion(n => n + 1)
    }
  }

  // ── Arranging by hand: free, no AI, not while a build runs ──────────────────────────────────────
  const outlineOf = (key: string) => (s.pages[key]?.sections ?? []) as OutlineSection[]
  const sections = useMemo(() => {
    const list = outlineOf(current)
    if (order?.page !== current) return list
    const byId = new Map(list.map(x => [x.id, x]))
    return order.ids.map(id => byId.get(id)).filter((x): x is OutlineSection => !!x)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.pages, current, order])
  const canArrange = !building && !working && !editing && !!currentPage && !currentPage.themed && stateOf(current) === 'done'

  const edit = useCallback(
    async (body: Record<string, unknown>, done?: string): Promise<EditView | null> => {
      setEditing(true)
      try {
        const v = await studioPost<EditView>('edit', { page: current, ...body })
        onView(v)
        setVersion(n => n + 1)
        if (v.literals) setLiterals(v.literals)
        if (done) showToast(done, 'success')
        return v
      } catch (e) {
        showToast((e as Error).message, 'error')
        return null
      } finally {
        setEditing(false)
        setOrder(null)
      }
    },
    [current, onView, showToast]
  )

  const moveSection = (page: string, id: string, before: string | null, ids?: string[]) => {
    if (!canArrange) return showToast(building ? 'Your site is being built. Wait for it to finish first.' : 'Wait for the last change to finish.', 'error')
    if (ids) setOrder({ page, ids })
    void edit({ page, op: 'move', blockId: id, before })
  }
  const hideSection = (x: OutlineSection) => void edit({ op: 'hide', blockId: x.id, hidden: !x.hidden }, x.hidden ? `“${x.label}” shows again` : `“${x.label}” is hidden`)
  const duplicateSection = async (x: OutlineSection) => {
    const v = await edit({ op: 'duplicate', blockId: x.id }, `Copied “${x.label}”`)
    const list = (v?.session?.pages[current]?.sections ?? []) as OutlineSection[]
    const copy = list[list.findIndex(y => y.id === x.id) + 1]
    if (copy) setPicked({ page: current, blockId: copy.id, label: copy.label })
  }
  const deleteSection = async (x: OutlineSection) => {
    const ok = await confirm({ title: `Delete “${x.label}” from this page?`, message: 'You can’t undo this here; designing the page again brings new sections.', confirmLabel: 'Delete', variant: 'danger' })
    if (!ok) return
    if (await edit({ op: 'delete', blockId: x.id }, `Deleted “${x.label}”`)) setPicked(p => (p?.blockId === x.id ? null : p))
  }

  // The picked section's words, links and pictures.
  useEffect(() => {
    setLiterals(null)
    if (!picked) return
    let stop = false
    fetch(studioUrl('edit', { page: picked.page, blockId: picked.blockId }), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { literals: [] }))
      .then((d: { literals?: CodeLiteral[] }) => !stop && setLiterals(d.literals ?? []))
      .catch(() => !stop && setLiterals([]))
    return () => {
      stop = true
    }
  }, [picked])
  const commitContent = (e: LiteralEdit) => {
    if (!picked) return
    if (building || working || editing) return showToast(building ? 'Your site is being built. Wait for it to finish first.' : 'Wait for the last change to finish.', 'error')
    void edit({ page: picked.page, op: 'content', blockId: picked.blockId, edits: [e] }, 'Saved')
  }
  const showOutline = homeReady && !!currentPage && !currentPage.themed && stateOf(current) === 'done'

  // The preview shows move handles while arranging is possible, and its drops arrive here.
  const arrange = canArrange && !picking
  const latest = useRef({ arrange, move: moveSection, outlineOf })
  latest.current = { arrange, move: moveSection, outlineOf }
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const w = previewWindow()
      if (!w || e.source !== w || e.origin !== window.location.origin || e.data?.type !== 'studio-preview') return
      const d = e.data
      if (d.event === 'ready') w.postMessage({ type: 'studio-preview', arrange: latest.current.arrange }, window.location.origin)
      else if (d.event === 'move' && typeof d.page === 'string' && typeof d.blockId === 'string' && typeof d.target === 'string') {
        const now = latest.current.outlineOf(d.page).map(x => x.id)
        const rest = now.filter(id => id !== d.blockId)
        const at = rest.indexOf(d.target)
        if (at < 0) return
        const cut = d.place === 'before' ? at : at + 1
        const ids = [...rest.slice(0, cut), d.blockId, ...rest.slice(cut)]
        if (ids.join() !== now.join()) latest.current.move(d.page, d.blockId, rest[cut] ?? null, ids)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  useEffect(() => {
    previewWindow()?.postMessage({ type: 'studio-preview', arrange }, window.location.origin)
  }, [arrange, version])

  const tweaksLeft = view.allowance.tweaksLeft
  const overlay = working ? (
    <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-foreground shadow">
      <Loader2 className="h-4 w-4 animate-spin" /> {working === 'tweak' ? 'Making your change…' : message ?? (working === 'retry' ? 'Trying again…' : 'Designing this page again…')}
    </span>
  ) : !homeReady ? (
    <span className="inline-flex flex-col items-center gap-2 text-center text-sm text-foreground-secondary">
      {building ? <Loader2 className="h-5 w-5 animate-spin" /> : <Circle className="h-5 w-5" />}
      {building ? `${showcase ? 'Your page' : 'Your home page'} appears here as soon as it is ready.` : 'Nothing built yet.'}
    </span>
  ) : undefined

  const icon = (p: ListPage) => {
    if (p.themed) return <Paintbrush className="h-3.5 w-3.5 text-foreground-muted" />
    const st = stateOf(p.key)
    if (st === 'done') return <Check className="h-3.5 w-3.5 org-sage-text" strokeWidth={3} />
    if (st === 'building') return <Loader2 className="h-3.5 w-3.5 animate-spin org-brown" />
    if (st === 'failed') return <AlertCircle className="h-3.5 w-3.5 text-red-600" />
    return <Circle className="h-3 w-3 text-foreground-muted" />
  }

  const viewable = (p: ListPage) => p.themed ? homeReady : stateOf(p.key) === 'done'

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">
            {building ? `Building your site · ${built} of ${total} pages` : s.status === 'ready' ? 'Your site is ready' : built ? `${built} of ${total} pages built` : 'Your site'}
          </div>
          <div className="mt-0.5 text-xs text-foreground-secondary" aria-live="polite">
            {building ? message ?? 'Working…' : s.status === 'ready' ? `${tweaksLeft} free change${tweaksLeft === 1 ? '' : 's'} left today` : s.error ?? ''}
          </div>
        </div>
        <DeviceToggle value={device} onChange={setDevice} />
      </div>
      {building && (
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-surface-secondary" aria-hidden>
          <div className="ecom-accent-bg h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(4, (built / Math.max(1, total)) * 100)}%` }} />
        </div>
      )}

      {!aiDown && !building && !working && (resumable || failedPages.length > 0) && (
        <div className={`${noteCls} mb-4 flex flex-wrap items-center justify-between gap-3 org-peach`} role="status">
          <span className="org-brown">
            {resumable
              ? s.error ?? 'The build stopped before your site was finished. Pages already built are kept.'
              : retryable.length
                ? `${failedPages.length === 1 ? `${failedPages[0].label} didn’t come out` : `${failedPages.length} pages didn’t come out`}. Trying again is free.`
                : 'Some pages didn’t come out after two tries. Use “Design this page again” on them.'}
          </span>
          {resumable ? (
            <button type="button" onClick={() => void startBuild()} className={primaryBtn}>
              <Sparkles className="h-4 w-4" /> Continue building
            </button>
          ) : retryable.length ? (
            <button type="button" onClick={() => void retry(retryable.map(p => p.key))} className={primaryBtn}>
              <RefreshCw className="h-4 w-4" /> {retryable.length === 1 ? 'Try again' : `Try ${retryable.length} pages again`}
            </button>
          ) : null}
        </div>
      )}

      {!building && !working && s.status === 'ready' && s.hasCatalog && (!s.hasPictures || !!s.missingPictures) && (
        <div className={`${noteCls} mb-4 flex flex-wrap items-center justify-between gap-3 org-sand`} role="status">
          <span className="text-foreground-secondary">
            {s.hasPictures && s.missingPictures ? `${s.missingPictures} sample product${s.missingPictures === 1 ? ' has' : 's have'} no photo yet` : 'No product photos yet'}
            {s.progress?.pictures?.error ? ': the image service wasn’t available' : ''}. The preview shows placeholders for them.
          </span>
          <button type="button" onClick={() => void addPhotos()} className={secondaryBtn}>
            <ImageIcon className="h-4 w-4" /> Add product photos
          </button>
        </div>
      )}

      {/* On desktop the page list and the preview scroll on their own, so the preview stays in view. */}
      <div className="grid grid-cols-1 gap-4 lg:h-[clamp(32rem,calc(100dvh-14rem),52rem)] lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Pages" className="max-lg:-mx-1 max-lg:overflow-x-auto ecom-scroll-x lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1 ecom-scroll-y">
          <ul className="flex gap-1.5 px-1 lg:flex-col lg:gap-0.5 lg:px-0">
            {pages.map(p => {
              const on = p.key === current
              const st = stateOf(p.key)
              const sec = st === 'building' ? section[p.key] : undefined
              return (
                <li key={p.key} className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => {
                      follow.current = false
                      show(p.key)
                    }}
                    disabled={!viewable(p)}
                    aria-current={on ? 'page' : undefined}
                    className={`ecom-focus flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${on ? 'ecom-current font-semibold text-foreground' : viewable(p) ? 'text-foreground-secondary ecom-hover hover:text-foreground' : 'text-foreground-muted'} max-lg:whitespace-nowrap max-lg:border max-lg:border-border-default`}
                  >
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon(p)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{p.label}</span>
                      {sec && <span className="block truncate text-[11px] font-normal text-foreground-muted">{`${sec.label} · ${sec.index + 1} of ${sec.total}`}</span>}
                    </span>
                    {p.themed && <span className="rounded-full bg-surface-secondary px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted max-lg:hidden">Themed</span>}
                  </button>
                  {!aiDown && st === 'failed' && !building && !working && retriesOf(p.key) < FREE_RETRIES && (
                    <button
                      type="button"
                      onClick={() => void retry([p.key])}
                      aria-label={`Try ${p.label} again`}
                      title="Try again (free)"
                      className="ecom-focus shrink-0 rounded-full p-1.5 text-foreground-muted ecom-hover hover:text-foreground"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:pr-1 ecom-scroll-y">
          {homeReady && !building && !aiDown && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { setPicking(p => !p); setPicked(null) }} disabled={!canTweak || !!working} aria-pressed={picking} className={picking ? `${primaryBtn} px-4 py-2` : `${secondaryBtn} px-4 py-2`}>
                <MousePointerClick className="h-4 w-4" /> {picking ? 'Click a section…' : 'Change a section'}
              </button>
              {/* A Showcase's design is free once, then a redesign from the wallet: neither spends the day's changes. */}
              <button type="button" onClick={rebuild} disabled={!canTweak || !!working || (!showcase && tweaksLeft < 5)} className={`${ghostBtn} px-3 py-2`}>
                <RefreshCw className="h-4 w-4" /> {paid ? `Design this page again · ₹${paid.priceInr}` : showcase ? 'Design this page again · Free' : 'Design this page again'}
              </button>
              {currentPage?.themed && <span className="text-xs text-foreground-muted">Themed page: it takes your look; the AI designs the main pages.</span>}
            </div>
          )}
          <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_16rem] xl:items-start xl:gap-4">
          <div className="min-w-0">
          <StudioPreview
            sessionId={s.id}
            page={current}
            device={device}
            version={version}
            picking={picking && canTweak}
            picked={picked}
            onPick={p => {
              setPicked(p)
              setPicking(false)
            }}
            onOpenPage={key => {
              const p = pages.find(x => x.key === key)
              if (p && viewable(p)) {
                follow.current = false
                show(key)
              }
            }}
            overlay={overlay}
          />
          {picked && !aiDown && (
            <form
              className="mt-3 rounded-2xl border border-border-default bg-surface-elevated p-4"
              onSubmit={e => {
                e.preventDefault()
                void tweak()
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="studio-tweak" className="text-sm font-semibold text-foreground">
                  Change “{picked.label}”
                </label>
                <button type="button" onClick={() => setPicked(null)} aria-label="Cancel" className="ecom-focus rounded-full p-1 text-foreground-muted ecom-hover hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <textarea
                id="studio-tweak"
                className={`${fieldInput} mt-2 min-h-20`}
                maxLength={600}
                autoFocus
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                placeholder="e.g. Make the headline shorter and put the picture on the left"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-foreground-muted">{tweaksLeft} free change{tweaksLeft === 1 ? '' : 's'} left today</span>
                <button type="submit" disabled={!!working || instruction.trim().length < 3 || tweaksLeft < 1} className={primaryBtn}>
                  {working === 'tweak' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Apply change
                </button>
              </div>
            </form>
          )}
          </div>
          {showOutline && (
            <aside aria-label="Sections on this page" className="mt-4 space-y-4 xl:mt-0">
              <div>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Sections on this page</h3>
                  {editing && <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-muted" aria-label="Saving" />}
                </div>
                <SectionList
                  sections={sections}
                  disabled={!canArrange}
                  picked={picked?.page === current ? picked.blockId : null}
                  onSelect={x => {
                    setPicked({ page: current, blockId: x.id, label: x.label })
                    setPicking(false)
                  }}
                  onMove={(id, before, ids) => moveSection(current, id, before, ids)}
                  onHide={hideSection}
                  onDuplicate={x => void duplicateSection(x)}
                  onDelete={x => void deleteSection(x)}
                />
                <p className="mt-2 text-xs text-foreground-muted">
                  Drag to reorder, here or by a section’s handle in the preview. Arranging is free: it doesn’t count against today’s changes.
                </p>
              </div>
              {picked && (
                <div className="rounded-2xl border border-border-default bg-surface-elevated p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">Words, links and pictures: {picked.label}</h3>
                    <button type="button" onClick={() => setPicked(null)} aria-label="Close" className="ecom-focus shrink-0 rounded-full p-1 text-foreground-muted ecom-hover hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <CodeContentFields literals={literals} disabled={building || !!working || editing} onCommit={commitContent} inputClass={fieldInput} />
                </div>
              )}
            </aside>
          )}
          </div>
        </div>
      </div>

      {!showcase && !building && !streaming && s.status !== 'ready' && s.status !== 'failed' && !built && view.allowance.free === 'used' && (
        <p className={`${noteCls} mt-4 bg-surface-secondary/60 text-foreground-secondary`}>
          You have used your free generation. Another full generation is available from Site Builder after your store is live, charged to your AI wallet.
        </p>
      )}
      {s.status === 'ready' && !showcase && (
        <div className={`${noteCls} mt-4 org-sage org-sage-text`}>
          Saved with your application. It is installed into your store when it goes live, with the sample products in your catalogue to edit or remove.
        </div>
      )}
      {!building && !homeReady && (
        <div className="mt-4">
          <button type="button" onClick={onBack} className={ghostBtn}>
            <ArrowLeft className="h-4 w-4" /> Look
          </button>
        </div>
      )}
    </div>
  )
}
