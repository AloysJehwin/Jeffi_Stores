'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, DragOverlay } from '@dnd-kit/core'
import {
  LayoutTemplate,
  Link2,
  MousePointer2,
  Palette,
  Plus,
  Redo2,
  Rocket,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Undo2,
  Unlink2,
  WandSparkles,
} from 'lucide-react'
import {
  DEFAULT_THEME,
  blockPlace,
  cloneDoc,
  emptyDoc,
  insertBlock,
  isChromePage,
  isPageKey,
  moveBlock,
  type Block,
  normalizeTheme,
  pageRefKey,
  removeBlock,
  surfaceAllows,
  topBlocks,
  updateBlock,
  type PageDoc,
  type PageKey,
  type PageRef,
  type SiteAudience,
  type SiteSurface,
  type SiteTemplate,
  type ThemeTokens,
} from '@jeffi/site-blocks'
import { useCanUseAi, useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { api } from '@/components/admin/kit/core'
import AdminSelect from '@/components/admin/AdminSelect'
import { homepagePreviewUrl } from '@/components/admin/homepage/HomepagePreview'
import type { SectionOptions } from '@/components/admin/homepage/editors/fields'
import { PLACEMENT_DEFAULT_AFTER } from '@/lib/catalog/homepage-sections'
import { coreBlockFor, isSectionBlock, siteRegistry } from '@/lib/site/blocks'
import { isListingKey, wrapListingDoc } from '@/lib/site/listing'
import BlockInspector from './BlockInspector'
import AiPanel, { type PageRedo } from './AiPanel'
import AiSiteBuilder from './AiSiteBuilder'
import { BlockLibrary, TemplatePanel, ThemePanel } from './SidePanels'
import { BlockList, DND_MEASURING, useBlockDnd, type NewItem, type Parent, type RowActions } from './BlockList'
import VisualEditor from './VisualEditor'

// Site Builder: one page on one layout at a time (store or business × desktop web, phone web, app). Left, the page's
// blocks (drag to reorder, or drag one in from the library); centre, the real store rendering the draft (click a block
// to select it, drag its handle to move it); right, the selected block, the block library, templates or the theme.
// Every change autosaves into the draft; nothing is live until Publish. Desktop and phone share one layout while
// "Same on phone" is on (the AI Site Studio installs them that way).

const SURFACE_LABEL: Record<SiteSurface, string> = { web: 'Desktop web', web_mobile: 'Phone web', app: 'App' }
const SURFACE_LAYOUT: Record<SiteSurface, 'desktop' | 'mobile' | 'app'> = { web: 'desktop', web_mobile: 'mobile', app: 'app' }
const SURFACE_WIDTH: Record<SiteSurface, number> = { web: 1280, web_mobile: 390, app: 390 }
const CARD: string = 'card'
const PAGES: { key: PageKey; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'products', label: 'All products' },
  { key: 'category', label: 'Category pages' },
  { key: 'brand', label: 'Brand pages' },
  { key: 'categories', label: 'All categories' },
  { key: 'brands', label: 'All brands' },
  { key: 'about', label: 'About' },
  { key: 'contact', label: 'Contact' },
  { key: 'support', label: 'Support' },
  { key: 'returns', label: 'Returns' },
  { key: 'product', label: 'Product page (every product)' },
  { key: 'cart', label: 'Cart' },
  { key: 'checkout', label: 'Checkout' },
  { key: 'search', label: 'Search results' },
  { key: 'login', label: 'Sign in' },
  { key: 'signup', label: 'Sign up' },
  { key: 'account', label: 'Account home' },
  { key: 'track', label: 'Order tracking (every order)' },
  { key: 'wishlist', label: 'Wishlist' },
  { key: 'compare', label: 'Compare' },
  { key: 'legal', label: 'Legal pages (every policy)' },
  { key: 'not_found', label: 'Page not found' },
  { key: 'catalog', label: 'Catalogue' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'orders', label: 'Orders' },
  { key: 'header', label: 'Header (every page)' },
  { key: 'footer', label: 'Footer (every page)' },
  { key: 'announcement', label: 'Announcement bar (every page)' },
  // The site-wide product card (AI Site Studio), once the site has that page.
  ...(isPageKey(CARD) ? [{ key: CARD, label: 'Product card (every product tile)' }] : []),
]

type Panel = 'block' | 'ai' | 'add' | 'templates' | 'theme'

// The business portal's pages Site Builder lays out.
const BUSINESS_ONLY: PageKey[] = ['catalog', 'quotes', 'orders']
const BUSINESS_PAGES: PageKey[] = ['home', 'about', 'support', ...BUSINESS_ONLY]
const STORE_PAGES = PAGES.filter(p => !BUSINESS_ONLY.includes(p.key))

// Where the canvas opens each previewable page on the store (the header, footer and announcement bar on the home page,
// the product card on the product list).
const PREVIEW_PATH: Partial<Record<PageKey, string>> = { home: '/', about: '/about', contact: '/contact', support: '/support', returns: '/return-policy', cart: '/cart', checkout: '/checkout', products: '/products', login: '/login', signup: '/signup', account: '/account', legal: '/legal', catalog: '/catalog', quotes: '/quotes', orders: '/orders', header: '/', footer: '/', announcement: '/', categories: '/categories', brands: '/brands', wishlist: '/wishlist', compare: '/compare', not_found: '/page-not-found' }
const previewPathOf = (page: PageKey) => PREVIEW_PATH[page] ?? (page === CARD ? '/products' : undefined)
// Pages that preview on a sample record (a product, category, brand, search or order from the store).
const SAMPLED: PageKey[] = ['product', 'category', 'brand', 'search', 'track']
type Samples = { product: string | null; category: string | null; brand: string | null; search: string | null; order: string | null }
type History = { past: PageDoc[]; future: PageDoc[] }

/** A page the AI Site Studio built: code sections, kept exactly as they are (no Products wrapper, no core block). */
const isCodePage = (d: PageDoc) => Object.values(d.blocks).some(b => b.type === 'code_section')
// Two copies of a layout are the same when their blocks and order are (compiled output is rebuilt on save).
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).filter(k => k !== 'compiled').sort().map(k => [k, canon((v as Record<string, unknown>)[k])]))
      : v
const sameDoc = (a: PageDoc, b: PageDoc) => JSON.stringify(canon({ blocks: a.blocks, order: a.order })) === JSON.stringify(canon({ blocks: b.blocks, order: b.order }))

export interface SiteBuilderEditorProps {
  options: SectionOptions
  planTypes: string[] | null
  business: boolean
  initialDraftId: string | null
  /** Whether Site Builder is the live builder (else publishing only saves its pages). */
  live?: boolean
  /** Custom pages (/p/<slug>) that already have a layout. */
  customPages?: { slug: string; title: string | null }[]
  drafts: { id: string; title: string | null; updated_at: string }[]
  /** The visual editor is switched on for this store (site_settings site_editor_enabled); the forms stay the default. */
  visual?: boolean
}

export default function SiteBuilderEditor({ options, planTypes, business, initialDraftId, drafts, live = true, customPages = [], visual = false }: SiteBuilderEditorProps) {
  const canWrite = useCanWrite('settings:write')
  const canAi = useCanUseAi('settings:write')
  const [picking, setPicking] = useState(true)
  const [pointed, setPointed] = useState<string | null>(null)
  const { showToast, showConfirm } = useToast()
  const [draftId, setDraftId] = useState<string | null>(initialDraftId)
  const [audience, setAudience] = useState<SiteAudience>('store')
  const [surface, setSurface] = useState<SiteSurface>('web')
  const [page, setPage] = useState<PageKey>('home')
  const [slug, setSlug] = useState('')
  const [customs, setCustoms] = useState(customPages)
  const [newPage, setNewPage] = useState<string | null>(null)
  const [samples, setSamples] = useState<Samples | null>(null)
  const [docs, setDocs] = useState<Record<string, PageDoc>>({})
  const [history, setHistory] = useState<Record<string, History>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>('block')
  const [theme, setTheme] = useState<ThemeTokens | null>(null)
  const [templates, setTemplates] = useState<{ builtIn: SiteTemplate[]; saved: SiteTemplate[] } | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [frameKey, setFrameKey] = useState(0)
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [busy, setBusy] = useState(false)
  const [pageRedo, setPageRedo] = useState<(PageRedo & { keys: string[]; before: Record<string, PageDoc> }) | null>(null)
  const [visualOn, setVisualOn] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const frameBox = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const draftDocs = useRef<Record<string, PageDoc> | null>(null)
  // Per page (audience:page:slug): whether an edit on desktop or phone applies to both copies.
  const [linked, setLinked] = useState<Record<string, boolean>>({})

  const ref: PageRef = useMemo(
    () => ({
      audience,
      surface,
      page: audience === 'business' ? (BUSINESS_PAGES.includes(page) ? page : 'home') : page,
      slug: audience === 'store' && page === 'custom' ? slug : '',
    }),
    [audience, surface, page, slug]
  )
  const key = pageRefKey(ref)
  const sibling: SiteSurface | null = surface === 'web' ? 'web_mobile' : surface === 'web_mobile' ? 'web' : null
  const siblingRef = useMemo(() => (sibling && surfaceAllows(sibling, ref.page) ? { ...ref, surface: sibling } : null), [ref, sibling])
  const siblingKey = siblingRef ? pageRefKey(siblingRef) : null
  const linkId = `${ref.audience}:${ref.page}:${ref.slug ?? ''}`
  const isLinked = !!siblingKey && !!linked[linkId]
  const doc = docs[key]
  const blocks = doc ? topBlocks(doc) : []
  const block = doc && selected ? doc.blocks[selected] : undefined
  const previewPath =
    ref.page === 'custom'
      ? `/p/${ref.slug}`
      : ref.page === 'product'
        ? samples?.product
          ? `/products/${samples.product}`
          : undefined
        : ref.page === 'category'
          ? samples?.category
            ? `/categories/${samples.category}`
            : undefined
          : ref.page === 'brand'
            ? samples?.brand
              ? `/brands/${samples.brand}`
              : undefined
            : ref.page === 'search'
              ? samples?.search
                ? `/products?search=${encodeURIComponent(samples.search)}`
                : undefined
              : ref.page === 'track'
                ? samples?.order
                  ? `/account/orders/${samples.order}`
                  : undefined
                : audience === 'store' || BUSINESS_PAGES.includes(ref.page)
          ? previewPathOf(ref.page)
          : undefined

  useEffect(() => {
    if (!SAMPLED.includes(page) || samples) return
    api<Samples>('/api/admin/site-builder?sample=1').then(r => r.ok && setSamples(r.data))
  }, [page, samples])
  const previewable = !!previewPath

  useEffect(() => {
    if (!surfaceAllows(surface, page)) setPage('home')
  }, [surface, page])

  function createPage() {
    const s = (newPage ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    if (s.length < 2) return showToast('Give the page a web address of at least two letters, like "our-story"', 'error')
    if (!customs.some(c => c.slug === s)) setCustoms(c => [...c, { slug: s, title: null }])
    setPage('custom')
    setSlug(s)
    setNewPage(null)
    setSelected(null)
  }

  // ── Loading ────────────────────────────────────────────────────────────────────────────────────
  const loadDraft = useCallback(async (id: string) => {
    const { ok, data } = await api<{ draft: { docs: { pages?: Record<string, PageDoc>; theme?: Record<string, ThemeTokens> } } }>(`/api/admin/site-builder/drafts/${id}`)
    if (!ok) return null
    draftDocs.current = data.draft.docs.pages ?? {}
    return data.draft.docs
  }, [])

  useEffect(() => {
    if (!draftId) return
    let stop = false
    ;(async () => {
      const d = await loadDraft(draftId)
      if (stop) return
      if (!d) {
        setDraftId(null)
        return
      }
      const tk = await api<{ token: string }>(`/api/admin/site-builder/drafts/${draftId}/preview?audience=${audience}`)
      if (!stop && tk.ok) setToken(tk.data.token)
    })()
    return () => {
      stop = true
    }
  }, [draftId, audience, loadDraft])

  // A page as stored: the draft's version, else the published one; null when it has neither.
  const storedDoc = useCallback(async (k: string): Promise<PageDoc | null> => {
    if (draftDocs.current?.[k]) return draftDocs.current[k]
    const { ok, data } = await api<{ doc: PageDoc }>(`/api/admin/site-builder?key=${encodeURIComponent(k)}`)
    return ok ? data.doc : null
  }, [])

  useEffect(() => {
    if (!draftId || docs[key]) return
    let stop = false
    ;(async () => {
      // The draft's own version of the page wins, so wait for the draft before falling back to the published one
      // (otherwise the first edit would overwrite the draft's page with published + that edit).
      if (!draftDocs.current) await loadDraft(draftId)
      if (stop) return
      const stored = await storedDoc(key)
      let next = stored ?? emptyDoc()
      // Studio pages stay as built: wrapping their sections in a Products block or adding the built-in core would
      // replace them on the store (and checkout's payment step would then refuse to save).
      if (!isCodePage(next)) {
        // A listing layout from before the slot keeps its sections between the products, inside the Products block.
        if (isListingKey(ref.page)) next = wrapListingDoc(next, () => crypto.randomUUID())
        // A page with a working core (product details, the cart) always has its block; a new layout starts with it.
        const core = coreBlockFor(ref.page)
        if (core && !Object.values(next.blocks).some(b => b.type === core.type)) {
          next = insertBlock(next, { id: crypto.randomUUID(), type: core.type, v: core.v, props: {} }, 0)
        }
      }
      // Desktop and phone start linked when their copies are the same (one responsive layout).
      if (siblingKey && linked[linkId] === undefined) {
        const other = docs[siblingKey] ?? (await storedDoc(siblingKey))
        const same = !!stored && !!other && sameDoc(stored, other)
        if (!stop) setLinked(l => (l[linkId] === undefined ? { ...l, [linkId]: same } : l))
      }
      if (!stop) setDocs(d => ({ ...d, [key]: next }))
    })()
    return () => {
      stop = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId, key, docs])

  useEffect(() => {
    if (!draftId) return
    api<{ builtIn: SiteTemplate[]; saved: SiteTemplate[] }>('/api/admin/site-builder/templates').then(r => r.ok && setTemplates(r.data))
  }, [draftId])

  useEffect(() => {
    if (!draftId) return
    ;(async () => {
      const d = await loadDraft(draftId)
      const own = (d?.theme as Record<string, ThemeTokens> | undefined)?.[audience]
      if (own) return setTheme(normalizeTheme(own))
      const { ok, data } = await api<{ tokens: ThemeTokens | null }>(`/api/admin/site-builder?theme=${audience}`)
      setTheme(normalizeTheme(ok && data.tokens ? data.tokens : DEFAULT_THEME))
    })()
  }, [draftId, audience, loadDraft])

  // ── A page designed again by the AI ───────────────────────────────────────────────────────────
  // The server plans and writes it (minutes) into the draft's layouts `keys`; it then loads here as an undoable change.
  useEffect(() => {
    if (!draftId) return
    let stop = false
    api<{ job: { key: string; status: string; surfaces?: SiteSurface[] } | null }>(`/api/admin/site-builder/ai/page?draft=${draftId}`).then(({ ok, data }) => {
      const j = data?.job
      if (stop || !ok || !j || j.status !== 'running') return
      const [aud, pg] = j.key.split(':') as [SiteAudience, PageKey]
      const keys = (j.surfaces ?? ['web']).map(s => pageRefKey({ audience: aud, surface: s, page: pg, slug: '' }))
      setPageRedo(r => r ?? { key: j.key, label: PAGES.find(p => p.key === pg)?.label ?? pg, keys, before: {}, status: 'running' })
    })
    return () => {
      stop = true
    }
  }, [draftId])

  useEffect(() => {
    if (!draftId || pageRedo?.status !== 'running') return
    const job = pageRedo
    let settled = false
    const t = setInterval(async () => {
      const { ok, data } = await api<{ job: { key: string; status: string; error?: string; skipped?: number } | null }>(`/api/admin/site-builder/ai/page?draft=${draftId}`)
      const j = data?.job
      if (settled || !ok || !j || j.key !== job.key || j.status === 'running') return
      settled = true
      clearInterval(t)
      if (j.status !== 'done') return setPageRedo({ ...job, status: 'failed', message: j.error || 'The AI could not design this page again.' })
      const pages = (await loadDraft(draftId))?.pages ?? {}
      setDocs(d => ({ ...d, ...Object.fromEntries(job.keys.filter(k => pages[k]).map(k => [k, pages[k]])) }))
      setHistory(h => ({ ...h, ...Object.fromEntries(Object.entries(job.before).map(([k, b]) => [k, { past: [...(h[k]?.past ?? []).slice(-49), b], future: [] }])) }))
      setFrameKey(n => n + 1)
      setPageRedo({ ...job, status: 'done', message: j.skipped ? `${j.skipped} section(s) could not be written; the page has the rest.` : undefined })
    }, 4000)
    return () => clearInterval(t)
  }, [draftId, pageRedo, loadDraft])

  async function startRedo() {
    if (!draftId || !doc || !canWrite) return
    const keys = [key, ...(isLinked && siblingKey ? [siblingKey] : [])]
    const surfaces = [ref.surface, ...(isLinked && siblingRef ? [siblingRef.surface] : [])]
    const { ok, data } = await api<{ error?: string }>('/api/admin/site-builder/ai/page', { method: 'POST', json: { draftId, ref: { audience: ref.audience, page: ref.page }, surfaces } })
    if (!ok) return showToast(data.error || 'The AI could not start; try again shortly', 'error')
    const label = PAGES.find(p => p.key === ref.page)?.label ?? ref.page
    setPageRedo({ key: `${ref.audience}:${ref.page}`, label, keys, before: Object.fromEntries(keys.filter(k => docs[k]).map(k => [k, docs[k]])), status: 'running' })
  }

  // ── Canvas ─────────────────────────────────────────────────────────────────────────────────────
  // Select: what the arrow tool is on. Drag: the canvas shows move handles on this page's blocks (the header, footer
  // and announcement bar are pages of their own, so their blocks get handles only while that page is open).
  const pickMessage = { type: 'site-builder:pick', on: picking, drag: canWrite, page: ref.page }
  const latest = useRef<{ selected: string | null; pick: typeof pickMessage; onMove: ((m: { id: string; target: string; place: string }) => void) | null }>({ selected, pick: pickMessage, onMove: null })
  latest.current.selected = selected
  latest.current.pick = pickMessage

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!frame.current || e.source !== frame.current.contentWindow) return
      const m = e.data
      if (m?.type === 'site-builder:select' && typeof m.id === 'string') {
        // A block of the header, footer or announcement bar: open that page; a page block from one of them: home.
        const at = typeof m.page === 'string' && isPageKey(m.page) && isChromePage(m.page) ? m.page : null
        setPage(p => (at && at !== p ? at : !at && isChromePage(p) ? 'home' : p))
        if (at || isChromePage(page)) setSlug('')
        setSelected(m.id)
        setPointed(typeof m.hint === 'string' && m.hint ? m.hint : null)
        setPanel(p => (p === 'ai' ? 'ai' : 'block'))
      }
      if (m?.type === 'site-builder:move' && typeof m.id === 'string' && typeof m.target === 'string') latest.current.onMove?.(m)
      if (m?.type === 'site-builder:ready') {
        frame.current.contentWindow?.postMessage({ type: 'site-builder:highlight', id: latest.current.selected }, '*')
        frame.current.contentWindow?.postMessage(latest.current.pick, '*')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [page])

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'site-builder:pick', on: picking, drag: canWrite, page: ref.page }, '*')
  }, [picking, canWrite, ref.page])

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'site-builder:highlight', id: selected }, '*')
  }, [selected])

  useEffect(() => {
    const box = frameBox.current
    if (!box) return
    const ro = new ResizeObserver(() => setScale(Math.min(1, box.clientWidth / SURFACE_WIDTH[surface])))
    ro.observe(box)
    return () => ro.disconnect()
  }, [surface, draftId])

  // ── Editing ────────────────────────────────────────────────────────────────────────────────────
  const save = useCallback(
    (k: string, r: PageRef, next: PageDoc, reload = true) => {
      if (!draftId) return
      clearTimeout(timers.current[k])
      setSaving('saving')
      timers.current[k] = setTimeout(async () => {
        const { ok, data } = await api<{ error?: string }>(`/api/admin/site-builder/drafts/${draftId}`, { method: 'PUT', json: { page: { ref: r, doc: next } } })
        setSaving(ok ? 'saved' : 'error')
        if (!ok) showToast(data.error || 'Could not save the draft', 'error')
        else {
          if (draftDocs.current) draftDocs.current[k] = next
          if (reload) setFrameKey(n => n + 1)
        }
      }, 700)
    },
    [draftId, showToast]
  )

  // The page's new document, on both copies while desktop and phone are linked.
  const put = useCallback(
    (next: PageDoc) => {
      setDocs(d => ({ ...d, [key]: next, ...(isLinked && siblingKey ? { [siblingKey]: next } : {}) }))
      save(key, ref, next)
      if (isLinked && siblingRef && siblingKey) save(siblingKey, siblingRef, next, false)
    },
    [key, ref, save, isLinked, siblingKey, siblingRef]
  )

  const change = useCallback(
    (fn: (d: PageDoc) => PageDoc) => {
      if (!doc || !canWrite) return
      const next = fn(doc)
      setHistory(h => ({ ...h, [key]: { past: [...(h[key]?.past ?? []).slice(-49), doc], future: [] } }))
      put(next)
    },
    [doc, canWrite, key, put]
  )

  const undo = () => {
    const h = history[key]
    if (!h?.past.length || !doc) return
    const prev = h.past[h.past.length - 1]
    setHistory(x => ({ ...x, [key]: { past: h.past.slice(0, -1), future: [doc, ...h.future] } }))
    put(prev)
  }
  const redo = () => {
    const h = history[key]
    if (!h?.future.length || !doc) return
    const [next, ...rest] = h.future
    setHistory(x => ({ ...x, [key]: { past: [...h.past, doc], future: rest } }))
    put(next)
  }

  async function toggleLinked() {
    if (!doc || !sibling || !siblingRef || !siblingKey || !canWrite) return
    if (isLinked) return setLinked(l => ({ ...l, [linkId]: false }))
    const other = docs[siblingKey] ?? (await storedDoc(siblingKey))
    if (!other || !sameDoc(other, doc)) {
      const ok = await showConfirm({
        title: `Use this layout on ${SURFACE_LABEL[sibling]} too?`,
        message: `${SURFACE_LABEL[sibling]} becomes a copy of this ${SURFACE_LABEL[surface]} layout, and your changes then apply to both. Nothing is live until you publish.`,
        confirmText: 'Use on both',
      })
      if (!ok) return
      setDocs(d => ({ ...d, [siblingKey]: doc }))
      save(siblingKey, siblingRef, doc, false)
    }
    setLinked(l => ({ ...l, [linkId]: true }))
  }

  // The block whose slot holds `id` (the Products block's between-products sections), if any.
  const parentOf = (id: string | null) =>
    id && doc ? Object.values(doc.blocks).find(b => Object.values(b.children ?? {}).some(ids => ids.includes(id))) ?? null : null

  // A new block (a library type, or a copy of a saved one) at `at` in the top level or the slot `parent`.
  function insertNew(item: NewItem, at: number, parent?: Parent) {
    if (!doc) return
    const id = crypto.randomUUID()
    let block: Block
    if (item.saved) block = { ...item.saved, id, children: undefined }
    else {
      const def = siteRegistry.get(item.type)
      if (!def) return
      block = { id, type: item.type, v: def.v, props: def.props.parse(ref.page === 'home' ? {} : { config: { placement: { after: PLACEMENT_DEFAULT_AFTER } } }) as Record<string, unknown> }
    }
    if (parent && !isSectionBlock(block.type)) return showToast('Only sections can go between the products', 'error')
    change(d => insertBlock(d, block, at, parent))
    setSelected(id)
    setPanel('block')
  }

  // A click in the library: after the selected block (with the Products block or one of its sections selected, a
  // section goes between the products).
  function addAfterSelected(item: NewItem) {
    if (!doc) return
    const host = selected && doc.blocks[selected]?.type === 'listing_main' ? doc.blocks[selected] : parentOf(selected)
    if (host && isSectionBlock(item.type)) {
      const list = host.children?.between ?? []
      return insertNew(item, selected && list.includes(selected) ? list.indexOf(selected) + 1 : list.length, { id: host.id, slot: 'between' })
    }
    const anchor = host && selected && host.children?.between?.includes(selected) ? host.id : selected
    insertNew(item, anchor && doc.order.includes(anchor) ? doc.order.indexOf(anchor) + 1 : doc.order.length)
  }

  const addBlock = (type: string) => addAfterSelected({ kind: 'new', type, label: siteRegistry.get(type)?.label ?? type })
  // A block from My blocks: a copy with a fresh id.
  const addSavedBlock = (saved: Block) => addAfterSelected({ kind: 'new', type: saved.type, label: saved.type, saved })

  const listAt = (d: PageDoc, parent?: Parent) => (parent ? (d.blocks[parent.id]?.children?.[parent.slot] ?? []) : d.order)

  const move = (id: string, delta: number) => {
    if (!doc) return
    const p = blockPlace(doc, id)
    if (!p) return
    const j = p.index + delta
    if (j < 0 || j >= listAt(doc, p.parent).length) return
    change(d => moveBlock(d, id, j, p.parent))
  }

  const actions: RowActions = {
    select: id => (setSelected(id), setPointed(null), setPanel(p => (p === 'ai' ? 'ai' : 'block'))),
    move,
    toggleHidden: id =>
      change(d => {
        const b = d.blocks[id]
        return updateBlock(d, id, { visibility: b.visibility?.hidden ? { ...b.visibility, hidden: false } : { ...b.visibility, hidden: true } })
      }),
    duplicate: id => {
      const b = doc?.blocks[id]
      const p = doc && blockPlace(doc, id)
      if (!b || !p || siteRegistry.get(b.type)?.locked) return
      const copy = crypto.randomUUID()
      change(d => insertBlock(d, { ...structuredClone(b), id: copy, children: undefined }, p.index + 1, p.parent))
      setSelected(copy)
    },
    remove: id => {
      const b = doc?.blocks[id]
      if (!b || siteRegistry.get(b.type)?.locked) return
      change(d => removeBlock(d, id))
      if (selected === id) setSelected(null)
    },
  }

  const dnd = useBlockDnd(doc, {
    onMove: (id, at, parent) => change(d => moveBlock(d, id, at, parent)),
    onInsert: insertNew,
  })

  // A move dropped on the canvas: before or after the block under the pointer, in that block's list.
  latest.current.onMove = ({ id, target, place }) => {
    if (!doc || !canWrite || id === target || !doc.blocks[id] || !doc.blocks[target]) return
    const t = blockPlace(doc, target)
    if (!t || t.parent?.id === id) return
    if (t.parent && !isSectionBlock(doc.blocks[id].type)) return showToast('Only sections can go between the products', 'error')
    const rest = listAt(doc, t.parent).filter(x => x !== id)
    const at = rest.indexOf(target) + (place === 'after' ? 1 : 0)
    const was = blockPlace(doc, id)
    if (was && (was.parent?.id ?? null) === (t.parent?.id ?? null) && was.index === at) return
    change(d => moveBlock(d, id, at, t.parent))
    setSelected(id)
  }

  const sourceDoc = async (k: string): Promise<PageDoc | null> => docs[k] ?? (await storedDoc(k))

  async function copyFrom(from: SiteSurface) {
    const src = await sourceDoc(pageRefKey({ ...ref, surface: from }))
    if (!src) return showToast(`${SURFACE_LABEL[from]} has no layout for this page yet`, 'error')
    const ok = await showConfirm({
      title: `Replace the ${SURFACE_LABEL[surface]} layout?`,
      message: `It becomes a copy of ${SURFACE_LABEL[from]}${isLinked && sibling ? ` (and so does ${SURFACE_LABEL[sibling]}, which shares this layout)` : ''}. Other layouts are not changed, and nothing is live until you publish.`,
      confirmText: 'Replace',
      type: 'danger',
    })
    if (!ok) return
    const allowed = new Set(siteRegistry.allowedOn(ref).map(d => d.type))
    const copy = cloneDoc(src, () => crypto.randomUUID())
    for (const b of Object.values(copy.blocks)) if (!allowed.has(b.type)) delete copy.blocks[b.id]
    change(() => ({ ...copy, order: copy.order.filter(id => copy.blocks[id]) }))
    setSelected(null)
  }

  async function applyTemplate(t: SiteTemplate) {
    const p = t.pages.find(x => x.page === ref.page && x.surface === surface && x.audience === audience) ?? t.pages.find(x => x.page === ref.page)
    if (!p) return
    const ok = await showConfirm({
      title: `Use "${t.name}"?`,
      message: `The ${SURFACE_LABEL[surface]} layout of this page is replaced with the template. Undo brings it back; nothing is live until you publish.`,
      confirmText: 'Use template',
    })
    if (!ok) return
    change(() => cloneDoc(p.doc, () => crypto.randomUUID()))
    setSelected(null)
  }

  async function saveTemplate(name: string) {
    if (!doc) return
    const { ok, data } = await api<{ error?: string }>('/api/admin/site-builder/templates', {
      method: 'POST',
      json: { name, pages: [{ audience, surface, page: ref.page, doc }] },
    })
    showToast(ok ? `Saved "${name}" to your templates` : data.error || 'Could not save the template', ok ? 'success' : 'error')
    if (ok) api<{ builtIn: SiteTemplate[]; saved: SiteTemplate[] }>('/api/admin/site-builder/templates').then(r => r.ok && setTemplates(r.data))
  }

  async function applyPack(t: SiteTemplate) {
    if (!draftId) return
    const ok = await showConfirm({
      title: `Apply "${t.name}" to the whole site?`,
      message: `Its theme and ${new Set(t.pages.map(p => p.page)).size} page layouts (desktop and phone) replace those pages in this draft. Products, categories and brands fill from your catalogue; review the copy, add your pictures, then publish.`,
      confirmText: 'Apply style',
    })
    if (!ok) return
    setBusy(true)
    const { ok: done, data } = await api<{ pages?: number; error?: string }>(`/api/admin/site-builder/drafts/${draftId}/pack`, { method: 'POST', json: { packId: t.id } })
    setBusy(false)
    if (!done) return showToast(data.error || 'Could not apply the style', 'error')
    // Reload every page and the theme from the draft.
    const d = await loadDraft(draftId)
    setHistory({})
    setSelected(null)
    setDocs({})
    const own = (d?.theme as Record<string, ThemeTokens> | undefined)?.[audience]
    if (own) setTheme(normalizeTheme(own))
    setFrameKey(n => n + 1)
    showToast(`Applied ${t.name} to ${data.pages ?? 0} layouts. Review, then publish.`, 'success')
  }

  async function deleteTemplate(t: SiteTemplate) {
    const { ok } = await api(`/api/admin/site-builder/templates?id=${t.id}`, { method: 'DELETE' })
    if (ok) setTemplates(x => (x ? { ...x, saved: x.saved.filter(s => s.id !== t.id) } : x))
  }

  const themeTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  function changeTheme(t: ThemeTokens) {
    setTheme(t)
    if (!draftId) return
    clearTimeout(themeTimer.current)
    setSaving('saving')
    themeTimer.current = setTimeout(async () => {
      const { ok } = await api(`/api/admin/site-builder/drafts/${draftId}`, { method: 'PUT', json: { theme: { audience, tokens: t } } })
      setSaving(ok ? 'saved' : 'error')
    }, 600)
  }

  // ── Drafts ─────────────────────────────────────────────────────────────────────────────────────
  function openDraft(id: string | null) {
    setVisualOn(false)
    setDraftId(id)
    setDocs({})
    setHistory({})
    setSelected(null)
    setPageRedo(null)
    draftDocs.current = null
    const url = new URL(window.location.href)
    if (id) url.searchParams.set('draft', id)
    else url.searchParams.delete('draft')
    window.history.replaceState(null, '', url)
  }

  async function newDraft() {
    setBusy(true)
    const { ok, data } = await api<{ id: string }>('/api/admin/site-builder/drafts', { method: 'POST', json: {} })
    setBusy(false)
    if (ok) openDraft(data.id)
    else showToast('Could not start a draft', 'error')
  }

  async function publish() {
    if (!draftId) return
    if (saving === 'saving') return showToast('Still saving your last change; publish in a moment.', 'error')
    const ok = await showConfirm({
      title: 'Publish this draft?',
      message: live
        ? 'Every page and theme change in it goes live for customers now.'
        : 'Its pages and theme are saved as Site Builder’s published version. Customers keep seeing the Homepage builder until you make Site Builder live.',
      confirmText: 'Publish',
    })
    if (!ok) return
    setBusy(true)
    const res = await api<{ published?: { pages: string[]; conflicts: Record<string, string[]> }; error?: string }>(`/api/admin/site-builder/drafts/${draftId}`, { method: 'POST' })
    setBusy(false)
    if (!res.ok) return showToast(res.data.error || 'Publish failed', 'error')
    const conflicts = Object.values(res.data.published?.conflicts ?? {}).flat().length
    showToast(conflicts ? `Published. ${conflicts} block(s) were also changed by someone else; your version was kept.` : 'Published', 'success')
    openDraft(null)
  }

  // Back from the visual editor: its saves went straight to the draft, so the pages load again from there.
  function closeVisual() {
    setVisualOn(false)
    setDocs({})
    setHistory({})
    setSelected(null)
    draftDocs.current = null
    setFrameKey(n => n + 1)
  }

  async function discard() {
    if (!draftId) return
    const ok = await showConfirm({ title: 'Delete this draft?', message: 'Its changes are lost; the live site is not affected.', confirmText: 'Delete', type: 'danger' })
    if (!ok) return
    await api(`/api/admin/site-builder/drafts/${draftId}`, { method: 'DELETE' })
    openDraft(null)
  }

  // ── Render ─────────────────────────────────────────────────────────────────────────────────────
  if (!draftId) {
    return (
      <div className="space-y-4">
      {audience === 'store' && <AiSiteBuilder onOpen={openDraft} />}
      <div className="rounded-xl border border-border-default bg-surface-elevated p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold text-foreground">You are looking at the live site</p>
          <p className="text-xs text-foreground-muted mt-1">Changes go into a draft and reach customers only when you publish.</p>
        </div>
        {canWrite && (
          <button type="button" disabled={busy} onClick={newDraft} className="inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg bg-accent-500 text-white disabled:opacity-50">
            <Plus className="w-4 h-4" /> New draft
          </button>
        )}
        {drafts.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Open drafts</p>
            {drafts.map(d => (
              <button key={d.id} type="button" onClick={() => openDraft(d.id)} className="w-full flex items-center justify-between rounded-lg border border-border-default px-3 py-2 text-sm hover:border-accent-500">
                <span className="text-foreground">{d.title || 'Untitled draft'}</span>
                <span className="text-xs text-foreground-muted">{new Date(d.updated_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      </div>
    )
  }

  // The visual editor works on the desktop web layout of a page the canvas can show.
  const canVisual = visual && previewable && !!token && surface !== 'app'
  if (canVisual && visualOn && draftId && token) {
    return (
      <VisualEditor
        draftId={draftId}
        pageRef={ref}
        title={`${PAGES.find(p => p.key === ref.page)?.label ?? ref.slug ?? ref.page} · ${audience === 'business' ? 'Business' : 'Store'}`}
        previewUrl={homepagePreviewUrl(audience, token, 'desktop', previewPath)}
        canWrite={canWrite}
        theme={theme}
        canAi={canAi}
        onClose={closeVisual}
        onPublish={publish}
      />
    )
  }

  const tab = (on: boolean) => `px-3 h-8 text-xs font-medium rounded-md ${on ? 'bg-accent-500 text-white' : 'text-foreground-muted hover:text-foreground'}`
  const iconBtn = 'p-1.5 rounded-md border border-border-default text-foreground-muted hover:text-foreground disabled:opacity-40'
  const h = history[key]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border-default bg-surface-elevated p-2">
        {business && (
          <div className="flex gap-0.5 rounded-lg border border-border-default p-0.5">
            {(['store', 'business'] as const).map(a => (
              <button key={a} type="button" className={tab(audience === a)} onClick={() => (setAudience(a), setSelected(null))}>
                {a === 'store' ? 'Store' : 'Business'}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-0.5 rounded-lg border border-border-default p-0.5">
          {(['web', 'web_mobile', 'app'] as const).map(s => (
            <button key={s} type="button" className={tab(surface === s)} onClick={() => (setSurface(s), !(isLinked && s !== 'app') && setSelected(null))}>
              {SURFACE_LABEL[s]}
            </button>
          ))}
        </div>
        {sibling && siblingRef && canWrite && (
          <button
            type="button"
            onClick={toggleLinked}
            aria-pressed={isLinked}
            title={
              isLinked
                ? `Your edits apply to ${SURFACE_LABEL.web} and ${SURFACE_LABEL.web_mobile}. Turn off to change ${SURFACE_LABEL[surface]} on its own.`
                : `${SURFACE_LABEL[surface]} is edited on its own. Turn on to use this layout on ${SURFACE_LABEL[sibling]} too.`
            }
            className={`inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium rounded-lg border ${isLinked ? 'border-accent-500 bg-accent-500/10 text-accent-600' : 'border-border-default text-foreground-muted hover:text-foreground'}`}
          >
            {isLinked ? <Link2 className="w-3.5 h-3.5" /> : <Unlink2 className="w-3.5 h-3.5" />} Same on {sibling === 'web_mobile' ? 'phone' : 'desktop'}
          </button>
        )}
        {audience === 'business' && (
          <div className="w-44">
            <AdminSelect
              sm
              value={BUSINESS_PAGES.includes(page) ? page : 'home'}
              options={BUSINESS_PAGES.filter(p => surfaceAllows(surface, p)).map(p => ({ value: p, label: PAGES.find(x => x.key === p)?.label ?? p }))}
              onChange={v => (setPage(v as PageKey), setSelected(null))}
            />
          </div>
        )}
        {audience === 'store' && (
          <div className="w-52">
            <AdminSelect
              sm
              value={page === 'custom' ? `custom:${slug}` : page}
              options={[
                ...STORE_PAGES.filter(p => surfaceAllows(surface, p.key)).map(p => ({ value: p.key, label: p.label })),
                ...(surface === 'app' ? [] : customs.map(c => ({ value: `custom:${c.slug}`, label: `Page: ${c.title ?? c.slug} (/p/${c.slug})` }))),
                ...(surface === 'app' || !canWrite ? [] : [{ value: '__new', label: '+ New page…' }]),
              ]}
              onChange={v => {
                setSelected(null)
                if (v === '__new') return setNewPage('')
                if (v.startsWith('custom:')) return (setPage('custom'), setSlug(v.slice(7)))
                setPage(v as PageKey)
                setSlug('')
              }}
            />
          </div>
        )}
        {audience === 'store' && newPage !== null && (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-foreground-muted">/p/</span>
            <input
              autoFocus
              className="h-9 w-40 rounded-lg border border-border-default bg-surface px-2 text-sm"
              placeholder="our-story"
              value={newPage}
              onChange={e => setNewPage(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createPage()}
            />
            <button type="button" onClick={createPage} className="px-3 h-9 text-sm font-medium rounded-lg bg-accent-500 text-white">
              Create
            </button>
            <button type="button" onClick={() => setNewPage(null)} className="px-2 h-9 text-sm text-foreground-muted">
              Cancel
            </button>
          </div>
        )}
        <div className="flex gap-1">
          <button type="button" className={iconBtn} disabled={!h?.past.length} onClick={undo} aria-label="Undo" title="Undo">
            <Undo2 className="w-4 h-4" />
          </button>
          <button type="button" className={iconBtn} disabled={!h?.future.length} onClick={redo} aria-label="Redo" title="Redo">
            <Redo2 className="w-4 h-4" />
          </button>
        </div>
        <span className="text-xs text-foreground-muted">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved to draft' : saving === 'error' ? 'Not saved' : ''}</span>
        {canVisual && (
          <button
            type="button"
            onClick={() => setVisualOn(true)}
            title="Click and type on the page itself (beta). Edits the desktop layout, which phones share when Same on phone is on."
            className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium rounded-lg border border-accent-500 text-accent-600 hover:bg-accent-500/10"
          >
            <WandSparkles className="w-3.5 h-3.5" /> Visual editor
          </button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          {canWrite && (
            <div className="w-48">
              <AdminSelect
                sm
                value=""
                placeholder="Copy layout from…"
                options={(['web', 'web_mobile', 'app'] as const)
                  .filter(s => s !== surface && surfaceAllows(s, ref.page))
                  .map(s => ({ value: s, label: SURFACE_LABEL[s] }))}
                onChange={v => v && copyFrom(v as SiteSurface)}
              />
            </div>
          )}
          {canWrite && (
            <button type="button" onClick={discard} className="inline-flex items-center gap-1.5 px-3 h-9 text-sm rounded-lg border border-border-default text-foreground-secondary">
              <Trash2 className="w-4 h-4" /> Delete draft
            </button>
          )}
          {canWrite && (
            <button type="button" disabled={busy} onClick={publish} className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-lg bg-accent-500 text-white disabled:opacity-50">
              <Rocket className="w-4 h-4" /> Publish
            </button>
          )}
        </div>
      </div>

      {/* Wide screens: the block list, the preview and the side panel each scroll on their own. The library drags into
          the block list, so one DndContext holds both. */}
      <DndContext
        id="site-builder-blocks"
        sensors={dnd.sensors}
        collisionDetection={dnd.collision}
        measuring={DND_MEASURING}
        onDragStart={dnd.onDragStart}
        onDragOver={dnd.onDragOver}
        onDragEnd={dnd.onDragEnd}
        onDragCancel={dnd.onDragCancel}
      >
      <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)_340px] gap-3 items-start xl:items-stretch xl:h-[calc(100dvh-8.5rem)] xl:min-h-[34rem]">
        <aside className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-2 min-w-0 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain [scrollbar-width:thin]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Blocks · {isLinked ? 'Desktop and phone' : SURFACE_LABEL[surface]}</p>
            {canWrite && (
              <button type="button" onClick={() => setPanel('add')} className="inline-flex items-center gap-1 text-xs font-medium text-accent-600">
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            )}
          </div>
          {!doc && <p className="text-sm text-foreground-muted">Loading…</p>}
          {doc && blocks.length === 0 && <p className="text-sm text-foreground-muted">No blocks on this layout yet. Add one (or drag it in from Add), copy another layout or start from a template.</p>}
          {doc && <BlockList doc={doc} dnd={dnd} selected={selected} canWrite={canWrite} actions={actions} />}
        </aside>

        <div className="min-w-0 space-y-2 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain [scrollbar-width:thin]">
        {audience === 'business' && ref.page !== 'home' && (
          <p className="text-xs text-foreground-muted">
            Business portal pages need a business sign-in, so the preview shows the sign-in page unless you are signed in there as a
            business customer. Your blocks are saved either way.
          </p>
        )}
        {(ref.page === 'login' || ref.page === 'signup') && (
          <p className="text-xs text-foreground-muted">
            If you are signed in to the store in this browser, its sign-in pages send you on, so the preview may show another page. Open
            the store in a private window to see them as a new visitor would.
          </p>
        )}
        <div ref={frameBox} className="relative rounded-xl border border-border-default bg-surface-secondary overflow-hidden min-w-0">
          {previewable && token && (
            <button
              type="button"
              onClick={() => setPicking(p => !p)}
              title={picking ? 'Arrow on: click a block in the preview to select it' : 'Arrow off: the preview works like the live site'}
              aria-pressed={picking}
              className={`absolute top-2 left-2 z-10 inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium shadow ${picking ? 'bg-accent-500 text-white' : 'bg-surface-elevated text-foreground-secondary border border-border-default'}`}
            >
              <MousePointer2 className="w-4 h-4" /> {picking ? 'Select' : 'Browse'}
            </button>
          )}
          {previewable && token ? (
            <div style={{ height: 760, overflow: 'hidden' }} className="flex justify-center">
              <iframe
                key={`${frameKey}:${audience}:${surface}:${previewPath}`}
                ref={frame}
                title="Site preview"
                src={homepagePreviewUrl(audience, token, SURFACE_LAYOUT[surface], previewPath)}
                style={{
                  flexShrink: 0,
                  width: SURFACE_WIDTH[surface],
                  height: 760 / scale,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top center',
                  border: 0,
                  background: 'white',
                }}
              />
            </div>
          ) : (
            <div className="p-6 text-sm text-foreground-muted">
              {previewable
                ? 'Loading the preview…'
                : isChromePage(ref.page)
                  ? 'The header, footer and announcement bar show on every page. Edit them here; they appear on the store once you publish.'
                  : 'Live preview covers the home pages for now. Changes to this page still save to the draft and go live when you publish.'}
            </div>
          )}
        </div>
        </div>

        <aside className="rounded-xl border border-border-default bg-surface-elevated p-3 space-y-3 min-w-0 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain [scrollbar-width:thin]">
          <div className={`grid gap-1 ${canAi ? 'grid-cols-5' : 'grid-cols-4'}`}>
            {(
              [
                ['block', SlidersHorizontal, 'Block'],
                ...(canAi ? ([['ai', Sparkles, 'AI']] as const) : []),
                ['add', Plus, 'Add'],
                ['templates', LayoutTemplate, 'Templates'],
                ['theme', Palette, 'Theme'],
              ] as const
            ).map(([id, Icon, label]) => (
              <button key={id} type="button" onClick={() => setPanel(id)} className={`flex flex-col items-center gap-0.5 rounded-md py-1.5 text-[11px] ${panel === id ? 'bg-accent-500/10 text-accent-600' : 'text-foreground-muted hover:text-foreground'}`}>
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
          {panel === 'block' &&
            (block ? (
              <BlockInspector
                key={block.id}
                block={block}
                pageRef={ref}
                options={options}
                canWrite={canWrite}
                onChange={next => change(d => updateBlock(d, next.id, next))}
                onTemplatesChanged={() => api<{ builtIn: SiteTemplate[]; saved: SiteTemplate[] }>('/api/admin/site-builder/templates').then(r => r.ok && setTemplates(r.data))}
                pointed={pointed}
              />
            ) : (
              <p className="text-sm text-foreground-muted">Select a block in the list or click it in the preview.</p>
            ))}
          {panel === 'ai' && doc && canAi && (
            <AiPanel
              doc={doc}
              pageRef={ref}
              block={block}
              pointed={pointed}
              picking={picking}
              onPickMode={() => setPicking(p => !p)}
              onApply={next => change(() => next)}
              theme={theme}
              onThemeChange={changeTheme}
              draftId={draftId}
              redo={pageRedo}
              onRedo={canWrite && ref.page !== 'custom' ? () => void startRedo() : undefined}
            />
          )}
          {panel === 'add' && doc && (
            <BlockLibrary
              pageRef={ref}
              doc={doc}
              planTypes={planTypes}
              onAdd={addBlock}
              saved={templates?.saved}
              onAddSaved={canWrite ? addSavedBlock : undefined}
              onDeleteSaved={canWrite ? deleteTemplate : undefined}
              draggable={canWrite}
            />
          )}
          {panel === 'templates' && (
            <TemplatePanel templates={templates} pageRef={ref} canWrite={canWrite} onApply={applyTemplate} onSave={saveTemplate} onDelete={deleteTemplate} onApplyPack={applyPack} />
          )}
          {panel === 'theme' && (theme ? <ThemePanel theme={theme} canWrite={canWrite} onChange={changeTheme} /> : <p className="text-sm text-foreground-muted">Loading…</p>)}
        </aside>
      </div>
      <DragOverlay dropAnimation={null}>
        {dnd.dragging ? (
          <div className="rounded-lg border border-accent-400 bg-surface px-3 py-2 text-sm font-medium text-foreground shadow-lg">{dnd.label || 'Block'}</div>
        ) : null}
      </DragOverlay>
      </DndContext>
    </div>
  )
}
