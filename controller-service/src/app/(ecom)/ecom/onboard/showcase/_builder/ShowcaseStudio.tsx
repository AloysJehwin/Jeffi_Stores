'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, CloudOff, Loader2, RotateCcw, Sparkles, Wallet } from 'lucide-react'
import { Card } from '../../../dashboard/_components/Card'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { noteCls, primaryBtn, secondaryBtn } from '../../ui'
import { isAiDown, studioGet, studioPost, type StudioError, type StudioView } from '../../_studio/api'
import BriefStep, { type BriefCopy } from '../../_studio/BriefStep'
import PlanStep from '../../_studio/PlanStep'
import DirectionsStep from '../../_studio/DirectionsStep'
import BuildStep from '../../_studio/BuildStep'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'

// The AI Site Studio for a Showcase (product 'showcase'): the store's studio steps (brief, plan, look, build with
// preview, drag-and-drop arranging, content editing and AI changes) worded for a business's one page. The first design
// is free; another (after starting over, or "Design this page again") is a redesign for a flat price from the wallet,
// shown before it starts. The studio's API calls carry ?product=showcase (onboard/_studio/api.ts studioProduct).

type Phase = 'intro' | 'brief' | 'plan' | 'direction' | 'build'
const PHASES: { id: Phase; label: string }[] = [
  { id: 'brief', label: 'Brief' },
  { id: 'plan', label: 'Sections' },
  { id: 'direction', label: 'Look' },
  { id: 'build', label: 'Build' },
]

const COPY: BriefCopy = {
  sell: { title: 'What do you do?', hint: 'Your work and services, in your own words.', placeholder: 'e.g. Candid wedding and pre-wedding photography across Tamil Nadu' },
  audience: { title: 'Who are your clients?', hint: 'Who comes to you, and why they choose you.', placeholder: 'e.g. Couples planning their wedding, and families for portraits' },
  notes: { hint: 'What makes your business special. Your logo from Details is used too.', placeholder: 'e.g. Twelve years behind the camera; albums delivered in three weeks' },
  finish: 'Plan my page',
  finishing: 'Planning your page…',
}

function phaseOf(v: StudioView | null): Phase {
  const s = v?.session
  if (!s) return 'intro'
  if (s.status === 'building' || s.status === 'ready' || s.status === 'failed' || Object.keys(s.pages ?? {}).length) return 'build'
  if (s.status === 'direction' && s.directions.length) return 'direction'
  if (s.plan) return 'plan'
  return 'brief'
}

const priceText = (p: NonNullable<StudioView['allowance']['paid']>) => `₹${p.priceInr} from your wallet`

export default function ShowcaseStudio({
  businessName,
  logoUrl,
  hasContent,
  onView,
}: {
  businessName: string
  logoUrl: string | null
  /** The owner added services, work, reviews, numbers or questions (their sections show only then). */
  hasContent: boolean
  /** Every new state of the studio, so the page around it knows when the page is ready to publish. */
  onView?: (v: StudioView) => void
}) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const [view, setView] = useState<StudioView | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('intro')
  const [busy, setBusy] = useState<string | null>(null)
  const [aiOff, setAiOff] = useState(false)
  const [checking, setChecking] = useState(false)
  const [walletLow, setWalletLow] = useState<{ message: string; topUpUrl: string | null } | null>(null)
  // A paid generation the owner confirmed: the build step starts it once, then this is cleared.
  const [paidStart, setPaidStart] = useState(false)
  const top = useRef<HTMLDivElement>(null)
  const low = useRef<HTMLDivElement>(null)
  const report = useRef(onView)
  report.current = onView

  const s = view?.session ?? null
  const built = !!s && Object.keys(s.pages ?? {}).length > 0
  const locked = !!s && (s.status === 'building' || built)
  const aiDown = aiOff || view?.ai?.available === false
  const paid = view?.allowance.paid ?? null
  // The free design is held back: another of the owner's sites was never paid for.
  const freeBlocked = !!view?.allowance.freeBlocked

  const apply = useCallback((v: StudioView, follow = true) => {
    setView(prev => ({ ...v, site: v.site ?? prev?.site, ai: v.ai ?? prev?.ai }))
    if (follow) setPhase(phaseOf(v))
    report.current?.(v)
  }, [])

  useEffect(() => {
    studioGet()
      .then(v => apply(v))
      .catch(e => setLoadErr((e as Error).message))
  }, [apply])

  useEffect(() => {
    if (phase !== 'build' || !paidStart) return
    const t = setTimeout(() => setPaidStart(false), 0)
    return () => clearTimeout(t)
  }, [phase, paidStart])

  // The top-up note sits above the studio: bring it into view from the button that asked.
  useEffect(() => {
    if (walletLow) low.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [walletLow])

  const go = (p: Phase) => {
    setPhase(p)
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const failed = (e: unknown) => (isAiDown(e) ? setAiOff(true) : showToast((e as Error).message, 'error'))

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

  async function checkAgain() {
    setChecking(true)
    try {
      const v = await studioGet({ fresh: true })
      apply(v, false)
      if (v.ai?.available === false) showToast('AI design is still not available. Try again in a little while.', 'info')
      else {
        setAiOff(false)
        showToast('AI design is available again.', 'success')
      }
    } catch (e) {
      showToast((e as Error).message, 'error')
    } finally {
      setChecking(false)
    }
  }

  const startOver = async () => {
    const ok = await confirm({
      title: 'Start over?',
      message:
        paid || view?.allowance.free === 'used'
          ? `Your answers, sections and look are cleared, and so is the page in the studio (your live site stays as it is until you publish again). Designing a new page costs ${paid ? priceText(paid) : 'a redesign from your wallet'}.`
          : 'Your answers, sections and look are cleared.',
      confirmLabel: 'Start over',
      variant: 'danger',
    })
    if (!ok) return
    await call('restart', 'start', { restart: true }, () => go('brief'))
  }

  const onWalletLow = useCallback((e: StudioError) => {
    const url = typeof e.data?.topUpUrl === 'string' ? e.data.topUpUrl : null
    setWalletLow({ message: e.message, topUpUrl: url })
  }, [])

  const steps = useMemo(() => PHASES.map(p => p.id), [])
  const at = steps.indexOf(phase)
  const reachable = (p: Phase) => {
    if (!s) return false
    if (p === 'brief') return true
    if (p === 'plan') return !!s.plan
    if (p === 'direction') return s.directions.length > 0
    return !!s.direction
  }

  const buildButton = (() => {
    if (!s) return null
    if (locked)
      return (
        <button type="button" onClick={() => go('build')} className={primaryBtn}>
          See your page <ArrowRight className="h-4 w-4" />
        </button>
      )
    if (paid)
      return (
        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            disabled={!s.direction}
            className={primaryBtn}
            title={s.direction ? undefined : 'Pick a look first'}
            onClick={async () => {
              const ok = await confirm({ title: 'Design your page in this look?', message: `It costs ${priceText(paid)}. If the page can’t be made, you aren’t charged.`, confirmLabel: `Design my page · ₹${paid.priceInr}` })
              if (!ok) return
              setWalletLow(null)
              setPaidStart(true)
              go('build')
            }}
          >
            <Sparkles className="h-4 w-4" /> Design my page · ₹{paid.priceInr}
          </button>
          <span className="text-xs text-foreground-muted">A redesign costs {priceText(paid)}; you aren’t charged if the page can’t be made.</span>
        </div>
      )
    return (
      <button type="button" onClick={() => go('build')} disabled={!s.direction} className={primaryBtn} title={s.direction ? undefined : 'Pick a look first'}>
        <Sparkles className="h-4 w-4" />
        {view?.allowance.free === 'resume' ? 'Continue designing · Free' : 'Design my page · Free'}
      </button>
    )
  })()

  const autoStart =
    !!s &&
    !aiDown &&
    s.status !== 'building' &&
    (paid ? paidStart : s.status !== 'ready' && !s.pages?.[SHOWCASE_PAGE_KEY] && view?.allowance.free !== 'used')

  return (
    <div className="space-y-4" ref={top}>
      {aiDown && !built && (
        <div role="status" className={`${noteCls} org-peach flex flex-col gap-3 sm:flex-row sm:items-center`}>
          <CloudOff className="h-5 w-5 shrink-0 org-brown" aria-hidden />
          <p className="min-w-0 flex-1 text-foreground">
            <strong className="font-semibold">AI design isn’t available right now.</strong> Your details are saved; come back in a little while to design your page.
          </p>
          <button type="button" onClick={checkAgain} disabled={checking} className={`${secondaryBtn} max-sm:w-full`}>
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Check again
          </button>
        </div>
      )}
      {walletLow && (
        <div ref={low} role="alert" className={`${noteCls} org-peach flex flex-col gap-3 sm:flex-row sm:items-center`}>
          <Wallet className="h-5 w-5 shrink-0 org-brown" aria-hidden />
          <p className="min-w-0 flex-1 text-foreground">{walletLow.message}</p>
          {walletLow.topUpUrl && (
            <a href={walletLow.topUpUrl} className={`${primaryBtn} max-sm:w-full`}>
              Add money to your wallet
            </a>
          )}
          <button type="button" onClick={() => setWalletLow(null)} className="text-xs font-medium text-foreground-muted hover:text-foreground">
            Dismiss
          </button>
        </div>
      )}
      <Card className="max-sm:px-4">
        {aiDown && built && (
          <p role="status" className={`${noteCls} org-peach mb-5 flex items-center gap-2 text-foreground`}>
            <CloudOff className="h-4 w-4 shrink-0 org-brown" aria-hidden /> AI changes aren’t available right now. Your page is kept.
          </p>
        )}
        {freeBlocked && s?.status !== 'building' && (
          <p role="status" className={`${noteCls} org-peach mb-5 flex items-start gap-2 text-foreground`}>
            <Wallet className="mt-0.5 h-4 w-4 shrink-0 org-brown" aria-hidden />
            <span>
              <strong className="font-semibold">This site’s AI design isn’t free.</strong> The free AI design is for one unpaid site at a time, and another of your sites hasn’t been paid for yet. To design this one free, publish and pay for that site, or finish it; or design this one now for {paid ? priceText(paid) : 'the redesign price from your wallet'}.
            </span>
          </p>
        )}
        {loadErr ? (
          <p className="text-sm text-red-600">{loadErr}</p>
        ) : !view ? (
          <div className="flex items-center gap-2 py-8 text-sm text-foreground-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> Opening the studio…
          </div>
        ) : phase === 'intro' || !s ? (
          <div className="flex flex-col items-start gap-4 py-2 sm:flex-row sm:items-center">
            <span className="org-peach inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl">
              <Sparkles className="h-7 w-7 org-brown" />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="font-display text-xl font-black text-foreground">Design your page with AI</h3>
              <p className="mt-1 text-sm text-foreground-secondary">
                Answer a few questions, pick a look, and the AI designs your page around your details, work and reviews, live on desktop and phone.{freeBlocked ? '' : ' Your first design is free.'}
              </p>
            </div>
            <button type="button" onClick={() => void call('start', 'start', {}, () => go('brief'))} disabled={!!busy || aiDown} className={`${primaryBtn} max-sm:w-full`}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Start <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
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
              {(s.plan || s.free_used_at) && (
                <button type="button" onClick={startOver} disabled={!!busy || s.status === 'building'} className="ecom-focus inline-flex items-center gap-1 text-xs font-medium text-foreground-muted hover:text-foreground disabled:opacity-40">
                  <RotateCcw className="h-3.5 w-3.5" /> Start over
                </button>
              )}
            </div>

            {phase === 'brief' && (
              <BriefStep
                answers={s.answers}
                logoUrl={logoUrl}
                storeName={s.brief?.storeName || businessName || 'Your business'}
                finishing={busy === 'finish'}
                copy={COPY}
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
                  if (locked) return go(s.plan ? 'plan' : 'brief')
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
                subject="business"
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
                storeName={s.brief?.storeName || businessName || 'Your business'}
                locked={locked}
                onChoose={async i => void (await call('choose', 'choose', { index: i }))}
                onShuffle={async i => void (await call('shuffle', 'directions', { action: 'shuffle', index: i }))}
                onNew={async (i, ask) => void (await call('new', 'directions', { action: 'new', index: i, ask }))}
                onAsk={async ask => void (await call('ask', 'directions', { action: 'generate', ask }))}
                onBack={() => go('plan')}
                footer={buildButton}
              />
            )}

            {phase === 'build' && (
              <>
                {!hasContent && (
                  <p className={`${noteCls} mb-4 bg-surface-secondary text-foreground-secondary`}>
                    Sections for your services, work, reviews, numbers and questions stay hidden until you add them in Details.
                  </p>
                )}
                <BuildStep
                  view={view}
                  onView={v => apply(v, false)}
                  aiDown={aiDown}
                  autoStart={autoStart}
                  onBack={() => go('direction')}
                  onAiDown={() => setAiOff(true)}
                  onWalletLow={onWalletLow}
                />
              </>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
