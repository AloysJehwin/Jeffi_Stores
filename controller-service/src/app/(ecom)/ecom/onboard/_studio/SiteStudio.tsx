'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, CloudOff, LayoutTemplate, Loader2, RotateCcw, Sparkles } from 'lucide-react'
import { ChoiceCards } from '../../_ui'
import { Card } from '../../dashboard/_components/Card'
import { useToast } from '@/contexts/ToastContext'
import { noteCls, primaryBtn, secondaryBtn } from '../ui'
import { isAiDown, studioGet, studioPost, type StudioView } from './api'
import BriefStep from './BriefStep'
import PlanStep from './PlanStep'
import DirectionsStep from './DirectionsStep'
import BuildStep from './BuildStep'
import ThemeGallery, { fetchThemes, type ThemeAvailable } from './ThemeGallery'
import type { StudioAnswers } from '@/lib/site/studio/types'
import { themeOfDirection } from '@/lib/site/themes/catalog'

// The "Your site" step as the AI Site Studio: brief → page plan → design direction → live build → preview and
// tweak. "I'll design it myself" stays. Everything is saved server-side (site_studio_sessions), so the owner can
// leave and come back to the same place.

export interface StudioSummary {
  free: 'available' | 'resume' | 'used' | null
  ready: boolean
  pages: number
  style: string | null
  /** What the store sells, for the brief-only fallback build after go-live. */
  description: string
  references: string[]
}

type Phase = 'intro' | 'brief' | 'plan' | 'direction' | 'build'
const PHASES: { id: Phase; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'plan', label: 'Pages' },
  { id: 'direction', label: 'Look' },
  { id: 'build', label: 'Build' },
]

function phaseOf(v: StudioView | null): Phase {
  const s = v?.session
  if (!s) return 'intro'
  if (s.status === 'building' || s.status === 'ready' || s.status === 'failed' || Object.keys(s.pages ?? {}).length) return 'build'
  if (s.status === 'direction' && s.directions.length) return 'direction'
  if (s.plan) return 'plan'
  return 'brief'
}

const describe = (a: Partial<StudioAnswers>) => [a.sell, a.audience && `For ${a.audience}`, a.mood && `Feel: ${a.mood}`, a.notes].filter(Boolean).join('. ').slice(0, 2000)

export default function SiteStudio({
  skip,
  onSkipChange,
  storeName,
  logoUrl,
  categories,
  onSummary,
}: {
  skip: boolean
  onSkipChange: (skip: boolean) => void
  storeName: string
  logoUrl: string | null
  categories: string[]
  onSummary: (s: StudioSummary) => void
}) {
  const { showToast } = useToast()
  const [view, setView] = useState<StudioView | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [busy, setBusy] = useState<string | null>(null)
  const top = useRef<HTMLDivElement>(null)
  const s = view?.session ?? null
  const built = !!s && Object.keys(s.pages ?? {}).length > 0
  const locked = !!s && (s.status === 'building' || built)
  // Site generation needs Claude through the AI gateway. While it is unreachable the owner carries on without it:
  // standard pages now, Site Builder later. A site already designed here is kept.
  const [aiOff, setAiOff] = useState(false)
  const [checking, setChecking] = useState(false)
  const aiDown = aiOff || view?.ai?.available === false
  const offline = aiDown && !built
  const autoSkipped = useRef(false)
  // Ready-made themes (ThemeGallery): offered once a style is ready; they need no AI, so they work while it is offline.
  const [mode, setMode] = useState<'ai' | 'theme'>('ai')
  const [themes, setThemes] = useState<ThemeAvailable | null>(null)
  const [gallery, setGallery] = useState(false)
  const fromTheme = themeOfDirection(s?.direction)
  const themed = !!fromTheme
  const themesOffered = (!!themes && Object.keys(themes).length > 0) || themed
  const showGallery = gallery || (mode === 'theme' && !built && s?.status !== 'building')

  useEffect(() => {
    fetchThemes().then(setThemes)
  }, [])

  useEffect(() => {
    if (themed) setMode('theme')
  }, [themed])

  const apply = useCallback((v: StudioView, follow = true) => {
    setView(prev => ({ ...v, store: v.store ?? prev?.store }))
    if (follow) setPhase(phaseOf(v))
  }, [])

  useEffect(() => {
    studioGet()
      .then(v => apply(v))
      .catch(e => setLoadErr((e as Error).message))
  }, [apply])

  useEffect(() => {
    if (offline && !skip && mode !== 'theme') {
      autoSkipped.current = true
      onSkipChange(true)
    }
  }, [offline, skip, onSkipChange, mode])

  async function checkAgain() {
    setChecking(true)
    try {
      const v = await studioGet({ fresh: true })
      apply(v, false)
      if (v.ai?.available === false) {
        showToast('AI site generation is still not available. You can carry on without it.', 'info')
        return
      }
      setAiOff(false)
      if (autoSkipped.current) {
        autoSkipped.current = false
        onSkipChange(false)
      }
      showToast('AI site generation is available again.', 'success')
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setChecking(false)
    }
  }

  const failed = (e: unknown) => (isAiDown(e) ? setAiOff(true) : showToast((e as Error).message, 'error'))

  useEffect(() => {
    // Until the studio has loaded, the wizard keeps what its draft said (a built site, the brief).
    if (!view) return
    const a = s?.answers ?? {}
    onSummary({
      free: view?.allowance.free ?? null,
      ready: s?.status === 'ready' && !!s.pages?.['store:home'],
      pages: Object.keys(s?.pages ?? {}).length,
      style: s?.direction?.name ?? null,
      description: describe(a),
      references: a.references ?? [],
    })
  }, [view, s, onSummary])

  const scrollTop = () => top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const go = (p: Phase) => {
    setPhase(p)
    scrollTop()
  }

  async function call(label: string, path: string, body: object = {}, then?: (v: StudioView) => void) {
    setBusy(label)
    try {
      const v = await studioPost(path, body)
      apply(v, false)
      then?.(v)
      return v
    } catch (e) {
      failed(e)
      return null
    } finally {
      setBusy(null)
    }
  }

  const start = () =>
    call('start', 'start', { prefill: { storeName, sell: categories.join(', '), logoUrl } }, () => go('brief'))

  const startOver = async () => {
    const msg =
      view?.allowance.free === 'used'
        ? 'Start over? Your designed site is cleared, and another full generation is only available from Site Builder after your store is live, charged to your AI wallet.'
        : 'Start over? Your answers, pages and look are cleared.'
    if (!window.confirm(msg)) return
    await call('restart', 'start', { restart: true, prefill: { storeName, sell: categories.join(', '), logoUrl } }, () => go('brief'))
  }

  // A theme left the free generation unused: the AI designs the site from a fresh brief instead.
  const designWithAi = async () => {
    if (!window.confirm('Design your site with AI instead? The theme’s pages are cleared, you answer a few questions, and your free AI generation designs a new site.')) return
    setMode('ai')
    await call('restart', 'start', { restart: true, prefill: { storeName, sell: categories.join(', '), logoUrl } }, () => go('brief'))
  }

  const steps = useMemo(() => PHASES.map(p => p.id), [])
  const at = steps.indexOf(phase)
  const reachable = (p: Phase) => {
    if (!s) return false
    if (p === 'brief') return true
    if (p === 'plan') return !!s.plan
    if (p === 'direction') return s.directions.length > 0
    return !!s.direction
  }

  return (
    <div className="space-y-4" ref={top}>
      <ChoiceCards<'ai' | 'theme' | 'self'>
        ariaLabel="How to start your site"
        columns={themesOffered ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}
        value={skip ? 'self' : mode}
        onChange={v => {
          if (v !== 'self') setMode(v)
          onSkipChange(v === 'self')
        }}
        options={[
          {
            value: 'ai',
            label: 'Design it with AI',
            description: offline
              ? 'Not available right now: AI site generation is offline.'
              : 'Describe your store and watch the AI design every page, live, on desktop and phone. Free for new stores.',
            disabled: offline,
          },
          ...(themesOffered
            ? [{ value: 'theme' as const, label: 'Pick a ready-made theme', description: 'Five styles in five colour palettes, ready at once with your details. Free, and your free AI generation stays for later.' }]
            : []),
          { value: 'self', label: 'I’ll design it myself', description: 'Start from our standard pages and change them later in Site Builder, where your first full AI generation is free.' },
        ]}
      />
      {offline && (
        <div role="status" className={`${noteCls} org-peach flex flex-col gap-3 sm:flex-row sm:items-center`}>
          <CloudOff className="h-5 w-5 shrink-0 org-brown" aria-hidden />
          <p className="min-w-0 flex-1 text-foreground">
            <strong className="font-semibold">AI site generation isn’t available right now.</strong> {themesOffered
              ? 'You can carry on: pick a ready-made theme, or start from our standard pages and design them with AI later in Site Builder, where your first full generation is free.'
              : 'You can carry on: your store starts with our standard pages, and you can design them with AI later in Site Builder, where your first full generation is free.'}
          </p>
          <button type="button" onClick={checkAgain} disabled={checking} className={`${secondaryBtn} max-sm:w-full`}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Check again
          </button>
        </div>
      )}
      {!skip && (!offline || mode === 'theme') && (
        <Card className="max-sm:px-4">
          {aiDown && !showGallery && (
            <p role="status" className={`${noteCls} org-peach mb-5 flex items-center gap-2 text-foreground`}>
              <CloudOff className="h-4 w-4 shrink-0 org-brown" aria-hidden /> AI changes aren’t available right now. Your designed site is kept.
            </p>
          )}
          {loadErr ? (
            <p className="text-sm text-red-600">{loadErr}</p>
          ) : !view ? (
            <div className="flex items-center gap-2 py-8 text-sm text-foreground-secondary">
              <Loader2 className="h-4 w-4 animate-spin" /> Opening the studio…
            </div>
          ) : showGallery ? (
            <ThemeGallery
              name={s?.brief?.storeName || storeName || 'Your store'}
              view={view}
              available={themes}
              onView={v => apply(v, false)}
              onApplied={(v, label) => {
                apply(v)
                setGallery(false)
                setMode('theme')
                scrollTop()
                showToast(`Your site is ready in the ${label} theme. Change anything you like.`, 'success')
              }}
              onCancel={built ? () => setGallery(false) : undefined}
            />
          ) : phase === 'intro' || !s ? (
            <div className="flex flex-col items-start gap-4 py-2 sm:flex-row sm:items-center">
              <span className="org-peach inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl">
                <Sparkles className="h-7 w-7 org-brown" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-xl font-black text-foreground">The AI Site Studio</h3>
                <p className="mt-1 text-sm text-foreground-secondary">
                  Answer a few questions, pick a look, and the AI designs your home, product, cart and checkout pages, with sample products so you see it for real.
                </p>
              </div>
              <button type="button" onClick={start} disabled={!!busy} className={`${primaryBtn} max-sm:w-full`}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Start <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                {fromTheme ? (
                  <p className="text-sm text-foreground-secondary">
                    Your site wears the <span className="font-semibold text-foreground">{s.direction?.name}</span> theme.
                  </p>
                ) : (
                <ol className="flex flex-wrap items-center gap-1.5" aria-label="Studio steps">
                  {PHASES.map((p, i) => {
                    const on = p.id === phase
                    const done = i < at
                    return (
                      <li key={p.id} className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!reachable(p.id) || on || !!busy}
                          onClick={() => go(p.id)}
                          aria-current={on ? 'step' : undefined}
                          className={`ecom-focus inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors ${on ? 'ecom-sel' : done ? 'org-sand text-foreground hover:bg-[var(--org-sand-deep)]' : 'text-foreground-muted'} disabled:cursor-default`}
                        >
                          {done && <Check className="h-3 w-3" strokeWidth={3} />}
                          {p.label}
                        </button>
                        {i < PHASES.length - 1 && <span className="h-px w-3 bg-border-default" aria-hidden />}
                      </li>
                    )
                  })}
                </ol>
                )}
                {fromTheme || (mode === 'theme' && built) ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <button type="button" onClick={() => setGallery(true)} disabled={!!busy || s.status === 'building'} className="ecom-focus inline-flex items-center gap-1 text-xs font-medium text-foreground-muted hover:text-foreground disabled:opacity-40">
                      <LayoutTemplate className="h-3.5 w-3.5" /> {fromTheme ? 'Change theme' : 'Browse themes'}
                    </button>
                    {fromTheme && view.allowance.free !== 'used' ? (
                      <button type="button" onClick={designWithAi} disabled={!!busy || s.status === 'building' || aiDown} className="ecom-focus inline-flex items-center gap-1 text-xs font-medium text-foreground-muted hover:text-foreground disabled:opacity-40">
                        <Sparkles className="h-3.5 w-3.5" /> Design with AI instead
                      </button>
                    ) : !fromTheme && (s.plan || s.free_used_at) ? (
                      <button type="button" onClick={startOver} disabled={!!busy || s.status === 'building'} className="ecom-focus inline-flex items-center gap-1 text-xs font-medium text-foreground-muted hover:text-foreground disabled:opacity-40">
                        <RotateCcw className="h-3.5 w-3.5" /> Start over
                      </button>
                    ) : null}
                  </div>
                ) : (
                  (s.plan || s.free_used_at) && (
                    <button type="button" onClick={startOver} disabled={!!busy || s.status === 'building'} className="ecom-focus inline-flex items-center gap-1 text-xs font-medium text-foreground-muted hover:text-foreground disabled:opacity-40">
                      <RotateCcw className="h-3.5 w-3.5" /> Start over
                    </button>
                  )
                )}
              </div>

              {phase === 'brief' && (
                <BriefStep
                  answers={s.answers}
                  logoUrl={logoUrl}
                  storeName={s.brief?.storeName || storeName || 'Your store'}
                  finishing={busy === 'finish'}
                  onSave={a => void studioPost('answer', { answers: a }).catch(() => {})}
                  onHelp={async (key, a) => {
                    try {
                      const r = await studioPost<{ suggestion: string; allowance: StudioView['allowance'] }>('answer', { answers: a, help: key })
                      setView(v => (v ? { ...v, allowance: r.allowance } : v))
                      return r.suggestion
                    } catch (e) {
                      failed(e)
                      return null
                    }
                  }}
                  onFinish={a => {
                    if (locked) {
                      go(s.plan ? 'plan' : 'brief')
                      return
                    }
                    void call('finish', 'answer', { answers: a, finish: true }, () => go('plan'))
                  }}
                />
              )}

              {phase === 'plan' && s.plan && (
                <PlanStep
                  plan={s.plan}
                  references={s.brief?.references ?? []}
                  locked={locked}
                  busy={busy === 'directions'}
                  onToggle={(key, on) => void call('toggle', 'plan', { enabled: { [key]: on } })}
                  onBack={() => go('brief')}
                  nextLabel={s.directions.length ? 'See the looks' : 'Choose a look'}
                  onNext={() => {
                    if (s.directions.length || locked) go(locked && !s.directions.length ? 'build' : 'direction')
                    else void call('directions', 'directions', { action: 'generate' }, () => go('direction'))
                  }}
                />
              )}

              {phase === 'direction' && (
                <DirectionsStep
                  directions={s.directions}
                  chosenId={s.direction?.id ?? null}
                  storeName={s.brief?.storeName || storeName || 'Your store'}
                  locked={locked}
                  onChoose={async i => void (await call('choose', 'choose', { index: i }))}
                  onShuffle={async i => void (await call('shuffle', 'directions', { action: 'shuffle', index: i }))}
                  onNew={async (i, ask) => void (await call('new', 'directions', { action: 'new', index: i, ask }))}
                  onAsk={async ask => void (await call('ask', 'directions', { action: 'generate', ask }))}
                  onBack={() => go('plan')}
                  footer={
                    <BuildButton
                      free={view.allowance.free}
                      chosen={!!s.direction}
                      built={locked}
                      onBuild={() => go('build')}
                    />
                  }
                />
              )}

              {phase === 'build' && (
                <BuildStep
                  view={view}
                  onView={v => apply(v, false)}
                  aiDown={aiDown}
                  autoStart={!aiDown && s.status !== 'building' && s.status !== 'ready' && !Object.keys(s.pages ?? {}).length && view.allowance.free !== 'used'}
                  onBack={() => go('direction')}
                  onAiDown={() => setAiOff(true)}
                />
              )}
            </>
          )}
        </Card>
      )}
      {!skip && !aiDown && s && phase !== 'build' && phase !== 'intro' && (
        <p className={`${noteCls} bg-surface-secondary/60 text-foreground-secondary`}>
          You can continue without building now: we&apos;ll build your site from your answers once your store is live.
        </p>
      )}
    </div>
  )
}

function BuildButton({ free, chosen, built, onBuild }: { free: 'available' | 'resume' | 'used'; chosen: boolean; built: boolean; onBuild: () => void }) {
  if (built)
    return (
      <button type="button" onClick={onBuild} className={primaryBtn}>
        See your site <ArrowRight className="h-4 w-4" />
      </button>
    )
  if (free === 'used')
    return <p className="max-w-sm text-right text-xs text-foreground-muted">You have used your free generation. Another full generation is available from Site Builder after your store is live, charged to your AI wallet.</p>
  return (
    <button type="button" onClick={onBuild} disabled={!chosen} className={primaryBtn} title={chosen ? undefined : 'Pick a look first'}>
      <Sparkles className="h-4 w-4" />
      {free === 'resume' ? 'Continue building' : 'Build my site, free'}
    </button>
  )
}

