'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CloudOff, Loader2, Minus, RotateCcw, Sparkles, X } from 'lucide-react'
import { api } from '@/components/admin/kit/core'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import { UI_STYLES } from '@/lib/site/studio/ui-styles'

type Range = { lowInr: number; highInr: number }
// What the next build costs (lib/site/site-generation.ts): the store's first is free, later ones come from the AI wallet.
type Quote = { free: boolean; capInr: number; range: Range; balanceInr: number; shortInr: number }
type Charge = { free: boolean; chargedInr?: number; capInr?: number }
type Current = { name: string; uiStyle: string | null; studio: boolean; colours: { primary: string; accent: string; neutral: string } }
type PageRow = { key: string; label: string; status: 'waiting' | 'building' | 'done' | 'failed' | 'skipped'; sections?: number; written?: number }

// A redesign's progress on its draft (lib/site/studio/redesign.ts).
type Build = {
  status?: 'running' | 'done' | 'failed' | 'stopped'
  step?: string
  style?: string
  pages?: PageRow[]
  note?: string
  error?: string
  code?: string
  free?: boolean
  resumable?: boolean
  resumeFree?: boolean
  charge?: Charge
}
type Overview = { available?: boolean; quote?: Quote | null; active?: { draftId: string; ai: Build } | null; current?: Current | null }
type StartReply = { draftId?: string; error?: string; code?: string; balanceInr?: number; neededInr?: number }

const SITE_AI = '/api/admin/site-builder/ai/site'

/**
 * "Redesign my whole site with AI": the AI Site Studio's pipeline for a live store. The owner keeps their design or
 * picks a style (with a site they like and their colours or new ones); the AI designs the product card and every page
 * into a new draft, page by page, which they review and publish.
 */
export default function AiSiteBuilder({ onOpen }: { onOpen: (draftId: string) => void }) {
  // On every plan: the first full generation is free, later ones are charged to the AI wallet.
  const canWrite = useCanWrite('settings:write')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [current, setCurrent] = useState<Current | null>(null)
  const [design, setDesign] = useState<string>('keep')
  const [reference, setReference] = useState('')
  const [colours, setColours] = useState<'keep' | 'new'>('keep')
  const [draft, setDraft] = useState<string | null>(null)
  const [build, setBuild] = useState<Build | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [polling, setPolling] = useState(false)
  // Whole-site generation runs on Claude; while it is unreachable the card says so and the owner builds by hand.
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const picked = useRef(false)

  const take = useCallback((data: Overview) => {
    setAvailable(data.available !== false)
    setQuote(data.quote ?? null)
    setCurrent(data.current ?? null)
    // A build that is running (or stopped) shows its progress again after a refresh.
    if (!picked.current && data.active) {
      setDraft(data.active.draftId)
      setBuild(data.active.ai)
      setPolling(data.active.ai.status === 'running')
    }
    picked.current = true
  }, [])

  async function checkAi(fresh = false) {
    setChecking(true)
    const { ok, data } = await api<Overview>(`${SITE_AI}${fresh ? '?fresh=1' : ''}`)
    if (ok) take(data)
    else setAvailable(true)
    setChecking(false)
  }

  useEffect(() => {
    void api<Overview>(SITE_AI).then(({ ok, data }) => (ok ? take(data) : setAvailable(true)))
  }, [take])

  useEffect(() => {
    if (!draft || !polling) return
    let after = 0
    const t = setInterval(async () => {
      const { ok, data } = await api<{ ai: Build | null; code?: string }>(`${SITE_AI}?draft=${draft}`)
      // The draft was deleted: its build stops with it.
      if (data.code === 'no_draft') {
        setPolling(false)
        setDraft(null)
        setBuild(null)
        return
      }
      if (!ok || !data.ai) return
      setBuild(data.ai)
      // The charge lands a moment after the build finishes; then the next build's price is new.
      if (data.ai.status !== 'running' && (data.ai.charge || data.ai.status === 'stopped' || ++after > 5)) {
        setPolling(false)
        void api<Overview>(SITE_AI).then(r => r.ok && take(r.data))
      }
    }, 4000)
    return () => clearInterval(t)
  }, [draft, polling, take])

  const running = build?.status === 'running'

  if (!canWrite) return null

  async function start(resume?: string) {
    setError(null)
    setStarting(true)
    const free = resume ? !!build?.resumeFree || !!quote?.free : !!quote?.free
    const { ok, data } = await api<StartReply>(SITE_AI, {
      method: 'POST',
      json: { design, reference: design !== 'keep' && reference.trim() ? reference.trim() : null, colours, expect: free ? 'free' : 'paid', ...(resume ? { resume } : {}) },
    })
    setStarting(false)
    if (data.code === 'ai_unavailable') {
      setAvailable(false)
      return setError(data.error || 'AI site generation isn’t available right now.')
    }
    if (data.code === 'wallet_low' && quote) return setQuote({ ...quote, free: false, balanceInr: data.balanceInr ?? 0, shortInr: data.neededInr ?? 0 })
    if (data.code === 'price_changed') void checkAi()
    // Another redesign is running: show its progress.
    if (data.code === 'busy' && data.draftId) {
      setDraft(data.draftId)
      setBuild({ status: 'running', step: 'A redesign is already running' })
      setPolling(true)
      return
    }
    if (!ok || !data.draftId) return setError(data.error || 'The AI could not start; try again shortly')
    setDraft(data.draftId)
    setBuild({ status: 'running', step: resume ? 'Carrying on with the remaining pages' : 'Reading your store' })
    setPolling(true)
  }

  function again() {
    setPolling(false)
    setDraft(null)
    setBuild(null)
    setError(null)
  }

  const pages = build?.pages ?? []
  const built = pages.filter(p => p.status === 'done').length
  const left = pages.filter(p => p.status !== 'done')
  const finished = !!build && !running && !!draft
  const input = 'w-full rounded-lg border border-border-secondary bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500'
  const primary = 'inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg bg-accent-500 text-white disabled:opacity-50'
  const secondary = 'inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg border border-border-secondary text-foreground disabled:opacity-50'

  return (
    <div className="rounded-xl border border-accent-500/40 bg-surface-elevated p-5 space-y-4">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Sparkles className="w-4 h-4 text-accent-600" /> Redesign my whole site with AI
        </p>
        <p className="text-xs text-foreground-muted mt-1">
          The AI Site Studio designs every page again (home, listings, product, cart, checkout, the account pages, header and footer) and your product card, in one style, with your own products and photos. It all goes into a new draft: nothing changes for customers until you publish it.
        </p>
      </div>

      {available === false && !running && !finished ? (
        <div role="status" className="flex flex-col gap-3 rounded-lg border border-border-secondary bg-surface p-3 sm:flex-row sm:items-center">
          <CloudOff className="w-4 h-4 shrink-0 text-foreground-muted" aria-hidden />
          <p className="min-w-0 flex-1 text-sm text-foreground-secondary">
            <span className="font-medium text-foreground">AI site generation isn’t available right now.</span> You can carry on and build your pages by hand below.
          </p>
          <button type="button" disabled={checking} onClick={() => void checkAi(true)} className={secondary}>
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Check again
          </button>
        </div>
      ) : running ? (
        <div className="space-y-3" aria-live="polite">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Loader2 className="w-4 h-4 animate-spin text-accent-600" />
            <span>
              {build?.step ?? 'Working'}
              {build?.style ? ` · ${build.style}` : ''}
            </span>
          </div>
          {pages.length > 0 && <Progress pages={pages} built={built} />}
          <p className="text-xs text-foreground-muted">Every page takes a minute or two, so the whole site takes a while. You can leave this page; the build carries on and shows here when you come back.</p>
        </div>
      ) : finished ? (
        <div className="space-y-3">
          {build?.status === 'done' && (
            <p className="text-sm text-foreground">
              Your {build.style ? `${build.style} ` : ''}redesign is ready: {built} of {pages.length} pages designed.
            </p>
          )}
          {build?.status === 'stopped' && (
            <p className="text-sm text-foreground">
              The build stopped before it finished. {built} of {pages.length} pages are in the draft.
            </p>
          )}
          {build?.status === 'failed' && <p className="text-sm text-red-600">{build.error || 'The AI could not finish.'}</p>}
          {build?.note && <p className="text-xs text-foreground-secondary">{build.note}</p>}
          {pages.length > 0 && <Progress pages={pages} built={built} />}
          {!build?.note && left.some(p => p.status === 'failed') && (
            <p className="text-xs text-foreground-secondary">
              Not designed: {left.filter(p => p.status === 'failed').map(p => p.label).join(', ')}. They keep their current design; open the draft and use “Design this page again” on any of them.
            </p>
          )}
          {build?.charge && <p className="text-xs text-foreground-secondary">{chargeNote(build.charge)}</p>}
          {build?.resumable && (build.resumeFree ? <p className="text-xs text-foreground-secondary">Carrying on is free: what is left of your free generation.</p> : quote && <GenerationCost quote={quote} onRecheck={() => void checkAi()} />)}
          <div className="flex flex-wrap items-center gap-2">
            {built > 0 && (
              <button type="button" onClick={() => draft && onOpen(draft)} className={primary}>
                Open the draft
              </button>
            )}
            {build?.resumable && (
              <button
                type="button"
                disabled={starting || (!build.resumeFree && !!quote && !quote.free && quote.shortInr > 0)}
                onClick={() => draft && void start(draft)}
                className={built > 0 ? secondary : primary}
              >
                <Sparkles className="w-4 h-4" /> {starting ? 'Starting…' : `Design the ${left.length} remaining page${left.length === 1 ? '' : 's'}`}
              </button>
            )}
            <button type="button" onClick={again} className="px-2 h-control text-sm text-foreground-muted hover:text-foreground">
              Start a new redesign
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <>
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-foreground-secondary">Design</legend>
            <div role="radiogroup" aria-label="Design" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              <Choice on={design === 'keep'} onClick={() => setDesign('keep')} title="Keep my design" blurb={current ? (current.studio ? `${current.name}, laid out afresh` : 'Your theme, laid out afresh') : 'Your theme, laid out afresh'}>
                {current && <Swatches colours={[current.colours.primary, current.colours.accent, current.colours.neutral]} />}
              </Choice>
              {UI_STYLES.map(s => (
                <Choice key={s.id} on={design === s.id} onClick={() => setDesign(s.id)} title={s.name} blurb={s.blurb}>
                  <span className="flex h-7 w-full items-center gap-1.5 rounded-md border border-border-default px-2" style={{ background: s.sample.bg }}>
                    <span className="h-2.5 w-7 rounded-sm" style={{ background: s.sample.primary }} />
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.sample.accent }} />
                    <span className="ml-auto h-1.5 w-8 rounded-full" style={{ background: s.sample.ink }} />
                  </span>
                </Choice>
              ))}
            </div>
          </fieldset>
          {design !== 'keep' && (
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-foreground-secondary">A site you like (optional; the AI takes its colours, type and feel, never its words)</span>
              <input type="url" className={input} placeholder="https://" value={reference} maxLength={500} onChange={e => setReference(e.target.value)} />
            </label>
          )}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-foreground-secondary">Colours</legend>
            <div role="radiogroup" aria-label="Colours" className="flex flex-wrap gap-2">
              <Choice on={colours === 'keep'} onClick={() => setColours('keep')} title="Keep my colours" inline>
                {current && <Swatches colours={[current.colours.primary, current.colours.accent, current.colours.neutral]} />}
              </Choice>
              <Choice on={colours === 'new'} onClick={() => setColours('new')} title={design !== 'keep' && reference.trim() ? 'From the site I like' : 'New colours'} inline />
            </div>
          </fieldset>
          {quote && <GenerationCost quote={quote} onRecheck={() => void checkAi()} />}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={starting || (!!quote && !quote.free && quote.shortInr > 0)} onClick={() => void start()} className={primary}>
              <Sparkles className="w-4 h-4" /> {starting ? 'Starting…' : 'Redesign my site'}
            </button>
            {error && <p className="text-xs text-red-600">{error}</p>}
          </div>
        </>
      )}
    </div>
  )
}

function Choice({ on, onClick, title, blurb, inline, children }: { on: boolean; onClick: () => void; title: string; blurb?: string; inline?: boolean; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onClick}
      className={`relative rounded-lg border text-left ${on ? 'border-accent-500 bg-surface' : 'border-border-default hover:border-accent-500/60'} ${inline ? 'inline-flex items-center gap-2 px-3 h-control' : 'flex flex-col items-start gap-1.5 p-2.5'}`}
    >
      {children}
      <span className="text-xs font-semibold text-foreground">{title}</span>
      {blurb && <span className="text-[11px] leading-snug text-foreground-muted">{blurb}</span>}
      {on && <Check className={`w-3.5 h-3.5 text-accent-600 ${inline ? '' : 'absolute right-2 top-2'}`} aria-hidden />}
    </button>
  )
}

function Swatches({ colours }: { colours: string[] }) {
  return (
    <span className="flex" aria-hidden>
      {colours.map((c, i) => (
        <span key={i} className="-ml-1 h-4 w-4 rounded-full border-2 border-surface-elevated first:ml-0" style={{ background: c }} />
      ))}
    </span>
  )
}

const ICON: Record<PageRow['status'], React.ReactNode> = {
  waiting: <span className="mx-1 h-1.5 w-1.5 rounded-full bg-border-secondary" />,
  building: <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-600" />,
  done: <Check className="w-3.5 h-3.5 text-green-600" />,
  failed: <X className="w-3.5 h-3.5 text-red-600" />,
  skipped: <Minus className="w-3.5 h-3.5 text-foreground-muted" />,
}

/** Every page of the build with how far it got. */
function Progress({ pages, built }: { pages: PageRow[]; built: number }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-secondary">
          <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${Math.round((built / Math.max(1, pages.length)) * 100)}%` }} />
        </div>
        <span className="text-xs text-foreground-muted">
          {built} of {pages.length} pages
        </span>
      </div>
      <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {pages.map(p => (
          <li key={p.key} className={`flex items-center gap-1.5 text-xs ${p.status === 'waiting' ? 'text-foreground-muted' : 'text-foreground-secondary'}`}>
            <span className="flex w-4 shrink-0 justify-center">{ICON[p.status]}</span>
            <span className="truncate">{p.label}</span>
            {p.status === 'building' && p.sections ? (
              <span className="shrink-0 text-foreground-muted">
                {p.written ?? 0}/{p.sections}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function chargeNote(c: Charge): string {
  if (c.free) return 'Free: your store’s first full AI generation.'
  if (!c.chargedInr) return 'No charge: the whole hold went back to your AI wallet.'
  return `Charged ₹${c.chargedInr.toFixed(2)} to your AI wallet; the rest of the ₹${c.capInr} hold went back.`
}

/** Before a build: free, or about what it costs from the AI wallet, with a top-up link when the wallet can't hold the cap. */
function GenerationCost({ quote, onRecheck }: { quote: Quote; onRecheck: () => void }) {
  if (quote.free) return <p className="text-xs text-foreground-secondary">Free: your store’s first full AI generation.</p>
  const r = quote.range
  return (
    <div className="space-y-2">
      <p className="text-xs text-foreground-secondary">
        About ₹{r.lowInr}–₹{r.highInr} from your AI wallet, at most ₹{quote.capInr}: what the AI uses, never more. The ₹{quote.capInr} is held while it works and what it doesn’t use goes back. Balance ₹{quote.balanceInr.toFixed(2)}.
      </p>
      {quote.shortInr > 0 && (
        <div className="rounded-lg border border-amber-500/50 bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-900/20 dark:text-amber-200">
          Add ₹{quote.shortInr.toFixed(2)} to your AI wallet to start. <a href={ap('/admin/wallet')} className="underline">Top up</a>, then{' '}
          <button type="button" onClick={onRecheck} className="underline">
            check again
          </button>
          .
        </div>
      )}
    </div>
  )
}
