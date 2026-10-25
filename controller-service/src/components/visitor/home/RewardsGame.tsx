'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { animate, motion, useMotionValue, useReducedMotion } from 'motion/react'
import { useAuth } from '@/contexts/AuthContext'
import { useCart } from '@/contexts/CartContext'
import { useToast } from '@/contexts/ToastContext'
import { cartCouponHref, couponTerms } from '@/components/visitor/coupons/terms'
import { SECTION_COPY_DEFAULTS, type RewardsGamePublic } from '@/lib/catalog/homepage-sections'
import type { GamePlay, GameState } from '@/lib/rewards/game'

const COPY = SECTION_COPY_DEFAULTS.rewards_game

export interface RewardsGameProps {
  game: RewardsGamePublic
  eyebrow?: string | null
  title?: string | null
  ctaLabel?: string | null
}

type Status = 'loading' | 'signed-out' | 'gone' | 'ready' | 'playing' | 'result'
type Prizes = RewardsGamePublic['prizes']
type PlayResponse = { ok: boolean; play: GamePlay; repeated: boolean }

const LIMIT_COPY: Record<RewardsGamePublic['playLimit'], string> = {
  once: 'Play once',
  daily: 'Play once a day',
  weekly: 'Play once a week',
}

const CTA =
  'inline-flex items-center justify-center rounded-xl bg-primary-500 px-8 py-3 font-bold text-white shadow-lg shadow-primary-500/20 transition-all hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-60'

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function RewardsGame({ game, eyebrow, title, ctaLabel }: RewardsGameProps) {
  const { user, isLoading: authLoading } = useAuth()
  const userId = user?.id ?? null
  const { showToast } = useToast()
  const reducedMotion = useReducedMotion() ?? false

  const [status, setStatus] = useState<Status>('loading')
  const [play, setPlay] = useState<GamePlay | null>(null)
  // The server's answer while the wheel/foil is still on its way to it.
  const [pending, setPending] = useState<GamePlay | null>(null)
  const [nextPlayAt, setNextPlayAt] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)
  const [autoReveal, setAutoReveal] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [confetti, setConfetti] = useState<Particle[] | null>(null)
  const mounted = useRef(true)
  const busy = useRef(false)

  const url = `/api/rewards/game/${encodeURIComponent(game.gameKey)}`

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadState = useCallback(async (): Promise<GameState | 'gone' | 'unauthorized' | null> => {
    try {
      const r = await fetch(url, { credentials: 'include' })
      if (r.status === 404) return 'gone'
      if (r.status === 401) return 'unauthorized'
      if (!r.ok) return null
      return (await r.json()) as GameState
    } catch {
      return null
    }
  }, [url])

  useEffect(() => {
    if (authLoading) return
    if (!userId) {
      setStatus('signed-out')
      return
    }
    let cancelled = false
    setStatus('loading')
    loadState().then(state => {
      if (cancelled) return
      if (state === 'gone') return setStatus('gone')
      if (state === 'unauthorized') return setStatus('signed-out')
      // Unknown state: let them try; the play call is idempotent and reports a repeat.
      if (!state) return setStatus('ready')
      setPlay(state.lastPlay)
      setNextPlayAt(state.nextPlayAt)
      setStatus(state.canPlay ? 'ready' : 'result')
    })
    return () => {
      cancelled = true
    }
  }, [authLoading, userId, loadState])

  const reveal = useCallback(
    (result: GamePlay, isFresh: boolean) => {
      if (!mounted.current) return
      busy.current = false
      setPending(null)
      setPlay(result)
      setFresh(isFresh)
      setAutoReveal(false)
      setStatus('result')
      const prize = game.prizes.find(p => p.id === result.prizeId)
      const won = prize ? prize.kind !== 'none' : result.coupon != null
      if (isFresh && won && !reducedMotion) setConfetti(makeParticles())
      // The play response carries no nextPlayAt; fetch it quietly for the "come back" line.
      if (game.playLimit !== 'once') {
        loadState().then(s => {
          if (mounted.current && s && typeof s === 'object') setNextPlayAt(s.nextPlayAt)
        })
      }
    },
    [game.playLimit, game.prizes, loadState, reducedMotion]
  )

  const startPlay = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    setStatus('playing')
    try {
      const r = await fetch(`${url}/play`, { method: 'POST', credentials: 'include' })
      if (!mounted.current) return
      if (r.status === 404 || r.status === 401) {
        busy.current = false
        setStatus(r.status === 404 ? 'gone' : 'signed-out')
        return
      }
      if (!r.ok) throw new Error('play')
      const data = (await r.json()) as PlayResponse
      if (!data.ok || !data.play) throw new Error('play')
      if (!mounted.current) return
      if (data.repeated) return reveal(data.play, false)
      setPending(data.play)
    } catch {
      if (!mounted.current) return
      busy.current = false
      setAutoReveal(false)
      setResetKey(k => k + 1)
      setStatus('ready')
      showToast('Could not play right now. Please try again.', 'error')
    }
  }, [url, reveal, showToast])

  const onLanded = useCallback(() => {
    if (pending) reveal(pending, true)
  }, [pending, reveal])

  const onCta = useCallback(() => {
    if (game.mode === 'scratch') setAutoReveal(true)
    void startPlay()
  }, [game.mode, startPlay])

  const copyCode = useCallback(
    async (code: string) => {
      try {
        await navigator.clipboard.writeText(code)
        showToast('Coupon code copied', 'success')
      } catch {
        showToast('Could not copy the code', 'error')
      }
    },
    [showToast]
  )

  useEffect(() => {
    if (!confetti) return
    const t = window.setTimeout(() => setConfetti(null), 1300)
    return () => window.clearTimeout(t)
  }, [confetti])

  if (status === 'gone') return null

  const canPlay = status === 'ready' || status === 'playing'
  const playing = status === 'playing'
  const heading = title ?? (game.mode === 'scratch' ? 'Scratch to win' : COPY.title)

  return (
    <section className="py-12 md:py-20 bg-surface-secondary">
      <div className="container mx-auto px-4">
        <div className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
          <div className="flex flex-col items-center gap-3 text-center md:items-start md:text-left">
            <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em]">
              {eyebrow ?? COPY.eyebrow}
            </p>
            <h2 className="text-2xl md:text-4xl font-black text-foreground tracking-tight">{heading}</h2>
            <p className="text-sm text-foreground-secondary">
              {LIMIT_COPY[game.playLimit]}. Win a coupon and it lands straight in your account.
            </p>

            {status === 'loading' && <Skeleton />}

            {status === 'signed-out' && (
              <p className="text-sm text-foreground-muted">Sign in to play — any coupon you win is saved for you.</p>
            )}

            {canPlay && (
              <div className="mt-2 flex flex-col items-center gap-2 md:items-start">
                <button type="button" onClick={onCta} disabled={playing} aria-busy={playing} className={CTA}>
                  {playing ? 'Playing…' : (ctaLabel ?? COPY.ctaLabel)}
                </button>
                {game.mode === 'scratch' && !reducedMotion && (
                  <p className="text-xs text-foreground-muted">or scratch the card with your finger</p>
                )}
              </div>
            )}

            <div aria-live="polite" className="w-full max-w-sm">
              {status === 'result' && play && (
                <ResultCard
                  play={play}
                  fresh={fresh}
                  playLimit={game.playLimit}
                  nextPlayAt={nextPlayAt}
                  onCopy={copyCode}
                />
              )}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[320px]">
            <div className={status === 'loading' ? 'opacity-70' : undefined} aria-busy={status === 'loading'}>
              {game.mode === 'wheel' ? (
                <Wheel
                  prizes={game.prizes}
                  pending={pending}
                  restingPrizeId={status === 'result' ? (play?.prizeId ?? null) : null}
                  reducedMotion={reducedMotion}
                  onLanded={onLanded}
                />
              ) : (
                <ScratchCard
                  prize={pending ?? (status === 'result' ? play : null)}
                  revealed={status === 'result'}
                  canPlay={canPlay}
                  reducedMotion={reducedMotion}
                  autoReveal={autoReveal}
                  resetKey={resetKey}
                  onFirstStroke={startPlay}
                  onReveal={onCta}
                  onLanded={onLanded}
                />
              )}
            </div>
            {status === 'signed-out' && <SignInOverlay round={game.mode === 'wheel'} />}
            {confetti && <Confetti particles={confetti} />}
          </div>
        </div>
      </div>
    </section>
  )
}

function Skeleton() {
  return (
    <div className="mt-2 w-full max-w-sm animate-pulse space-y-3" aria-hidden="true">
      <div className="h-4 w-2/3 rounded bg-border-default" />
      <div className="h-4 w-1/2 rounded bg-border-default" />
      <div className="h-12 w-36 rounded-xl bg-border-default" />
    </div>
  )
}

function SignInOverlay({ round }: { round: boolean }) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center bg-secondary-900/40 backdrop-blur-[1px] ${round ? 'rounded-full' : 'rounded-2xl'}`}
    >
      <div className="mx-4 rounded-2xl border border-border-default bg-surface-elevated px-5 py-4 text-center shadow-xl">
        <p className="text-sm font-bold text-foreground">Sign in to play</p>
        <p className="mt-0.5 text-xs text-foreground-muted">Your coupon is saved to your account.</p>
        <Link
          href="/login?redirect=/"
          className="mt-3 inline-flex items-center justify-center rounded-xl bg-primary-500 px-5 py-2 text-sm font-bold text-white transition-colors hover:bg-primary-600"
        >
          Sign in
        </Link>
      </div>
    </div>
  )
}

function ResultCard({
  play,
  fresh,
  playLimit,
  nextPlayAt,
  onCopy,
}: {
  play: GamePlay
  fresh: boolean
  playLimit: RewardsGamePublic['playLimit']
  nextPlayAt: string | null
  onCopy: (code: string) => void
}) {
  const { cartCount } = useCart()
  const coupon = play.coupon
  const status = coupon?.status ?? 'usable'
  const again =
    playLimit === 'once'
      ? "You've played this one."
      : nextPlayAt
        ? `Come back after ${formatWhen(nextPlayAt)}.`
        : playLimit === 'daily'
          ? 'Come back tomorrow.'
          : 'Come back next week.'
  return (
    <div className="mt-2 w-full rounded-2xl border border-border-default bg-surface-elevated p-5 text-left shadow-sm">
      <p className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em]">
        {fresh ? (coupon ? 'You won' : 'This time') : 'Your last play'}
      </p>
      <p className="mt-1 text-xl font-black text-foreground">{play.prizeLabel}</p>
      {coupon ? (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <code
              className={`min-w-0 flex-1 truncate rounded-lg border border-dashed border-border-secondary bg-surface-secondary px-3 py-2 font-mono text-sm font-bold tracking-wider ${status === 'usable' ? 'text-foreground' : 'text-foreground-muted line-through'}`}
            >
              {coupon.code}
            </code>
            {status === 'usable' && (
              <button
                type="button"
                onClick={() => onCopy(coupon.code)}
                className="shrink-0 rounded-lg border border-border-default px-3 py-2 text-sm font-semibold text-foreground transition-colors hover:border-accent-400 hover:text-accent-600 dark:hover:border-accent-500 dark:hover:text-accent-400"
              >
                Copy
              </button>
            )}
          </div>
          <p className="text-xs text-foreground-muted">{couponTerms(coupon)}</p>
          {status !== 'usable' ? (
            <p className="text-xs font-semibold text-foreground-secondary">
              {status === 'used' ? 'You have used this coupon.' : 'This coupon has expired.'}
            </p>
          ) : cartCount === 0 ? (
            <p className="text-xs text-foreground-secondary">
              Saved to your account. Add something to your cart and apply it there.
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            {status === 'usable' && (
              <Link
                href={cartCount > 0 ? cartCouponHref(coupon.code) : '/products'}
                className="inline-flex items-center justify-center rounded-xl bg-accent-500 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-accent-600"
              >
                {cartCount > 0 ? 'Apply in cart' : 'Shop now'} &rarr;
              </Link>
            )}
            <Link
              href="/account/rewards#coupons"
              className="text-sm font-semibold text-accent-600 transition-colors hover:text-accent-700 dark:text-accent-400 dark:hover:text-accent-300"
            >
              Your coupons
            </Link>
          </div>
        </div>
      ) : (
        <p className="mt-2 text-sm text-foreground-secondary">No coupon this time — thanks for playing.</p>
      )}
      <p className="mt-3 text-xs text-foreground-muted">{again}</p>
    </div>
  )
}

// ---- Wheel ---------------------------------------------------------------------------------------

const C = 160
const R = 148
const LABEL_MAX = 14
const rad = (deg: number) => (deg * Math.PI) / 180
// Angles are clockwise from 12 o'clock, where the pointer sits.
const point = (deg: number, r: number) => [C + r * Math.sin(rad(deg)), C - r * Math.cos(rad(deg))] as const

function wedge(i: number, seg: number): string {
  const [x0, y0] = point(i * seg, R)
  const [x1, y1] = point((i + 1) * seg, R)
  return `M${C} ${C} L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${seg > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`
}

function tint(i: number, n: number): string {
  // An odd count would put two like tints at the seam; the last segment takes a third.
  if (n % 2 === 1 && i === n - 1) return 'fill-accent-300'
  return i % 2 === 0 ? 'fill-accent-200' : 'fill-primary-200'
}

function shortLabel(label: string): string {
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1).trimEnd()}…` : label
}

function Wheel({
  prizes,
  pending,
  restingPrizeId,
  reducedMotion,
  onLanded,
}: {
  prizes: Prizes
  pending: GamePlay | null
  restingPrizeId: string | null
  reducedMotion: boolean
  onLanded: () => void
}) {
  const n = prizes.length
  const seg = 360 / n
  const rotation = useMotionValue(0)
  const [highlight, setHighlight] = useState<number | null>(null)
  const spun = useRef(false)
  const prizesRef = useRef(prizes)
  const onLandedRef = useRef(onLanded)
  useEffect(() => {
    prizesRef.current = prizes
    onLandedRef.current = onLanded
  }, [prizes, onLanded])

  // Rotation that puts segment `i` under the pointer after `turns` full spins, landing a little
  // off-centre (within ±35% of the segment) so it never sits on an edge. Always moves forward.
  const landing = useCallback(
    (i: number, turns: number) => {
      const centre = i * seg + seg / 2
      const jitter = (Math.random() * 2 - 1) * seg * 0.35
      const base = Math.ceil(rotation.get() / 360) * 360
      return base + turns * 360 + (360 - centre) + jitter
    },
    [rotation, seg]
  )

  // Resting on an earlier result: point at it without spinning.
  useEffect(() => {
    if (spun.current || pending || !restingPrizeId) return
    const i = prizesRef.current.findIndex(p => p.id === restingPrizeId)
    if (i < 0) return
    rotation.set(landing(i, 0))
    setHighlight(i)
  }, [restingPrizeId, pending, rotation, landing])

  useEffect(() => {
    if (!pending) return
    const i = Math.max(
      0,
      prizesRef.current.findIndex(p => p.id === pending.prizeId)
    )
    spun.current = true
    if (reducedMotion) {
      rotation.set(landing(i, 0))
      setHighlight(i)
      const t = window.setTimeout(() => onLandedRef.current(), 600)
      return () => window.clearTimeout(t)
    }
    setHighlight(null)
    const controls = animate(rotation, landing(i, 4 + Math.floor(Math.random() * 2)), {
      duration: 4 + Math.random(),
      ease: [0.12, 0.82, 0.16, 1],
      onComplete: () => {
        setHighlight(i)
        onLandedRef.current()
      },
    })
    return () => controls.stop()
  }, [pending, reducedMotion, rotation, landing])

  const fontSize = n <= 6 ? 13 : 11

  return (
    <div
      role="img"
      aria-label={`Prize wheel: ${prizes.map(p => p.label).join(', ')}`}
      className="relative mx-auto aspect-square w-full max-w-[320px] select-none"
    >
      <motion.div style={{ rotate: rotation }} className="h-full w-full will-change-transform">
        <svg viewBox="0 0 320 320" className="h-full w-full drop-shadow-xl">
          <circle cx={C} cy={C} r={R + 8} className="fill-surface-elevated stroke-border-default" strokeWidth={2} />
          {prizes.map((p, i) => (
            <path key={p.id} d={wedge(i, seg)} className={`${tint(i, n)} stroke-surface-elevated`} strokeWidth={2} />
          ))}
          {prizes.map((p, i) => (
            <text
              key={p.id}
              x={C + 54}
              y={C}
              transform={`rotate(${i * seg + seg / 2 - 90} ${C} ${C})`}
              dominantBaseline="middle"
              fontSize={fontSize}
              fontWeight={700}
              className="fill-secondary-800"
            >
              {shortLabel(p.label)}
            </text>
          ))}
          {highlight != null && (
            <motion.path
              key={highlight}
              d={wedge(highlight, seg)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="fill-accent-500/30 stroke-accent-600"
              strokeWidth={3}
              strokeLinejoin="round"
            />
          )}
        </svg>
      </motion.div>
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-surface-elevated bg-primary-500 shadow-md" />
      <svg
        viewBox="0 0 24 28"
        className="pointer-events-none absolute -top-2 left-1/2 h-8 w-7 -translate-x-1/2 drop-shadow"
        aria-hidden="true"
      >
        <path
          d="M12 27 2 4h20z"
          className="fill-foreground stroke-surface-elevated"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

// ---- Scratch card --------------------------------------------------------------------------------

const W = 320
const H = 200
const BRUSH = 44
const THRESHOLD = 0.55

function ScratchCard({
  prize,
  revealed,
  canPlay,
  reducedMotion,
  autoReveal,
  resetKey,
  onFirstStroke,
  onReveal,
  onLanded,
}: {
  prize: GamePlay | null
  revealed: boolean
  canPlay: boolean
  reducedMotion: boolean
  autoReveal: boolean
  resetKey: number
  onFirstStroke: () => void
  onReveal: () => void
  onLanded: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const swatchA = useRef<HTMLSpanElement>(null)
  const swatchB = useRef<HTMLSpanElement>(null)
  const swatchC = useRef<HTMLSpanElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const moves = useRef(0)
  const stroked = useRef(false)
  const clearedRef = useRef(false)
  const revealedAtMount = useRef(revealed)
  const onLandedRef = useRef(onLanded)
  const [cleared, setCleared] = useState(false)
  const [foilGone, setFoilGone] = useState(revealed)
  const [hintGone, setHintGone] = useState(false)
  const scratchable = canPlay && !reducedMotion

  useEffect(() => {
    onLandedRef.current = onLanded
  }, [onLanded])

  const paintFoil = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = W * dpr
    canvas.height = H * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    // Foil colours come from the theme via the swatch spans, never literals.
    const colour = (el: HTMLElement | null) => getComputedStyle(el ?? canvas).color
    const g = ctx.createLinearGradient(0, 0, W, H)
    g.addColorStop(0, colour(swatchA.current))
    g.addColorStop(0.55, colour(swatchB.current))
    g.addColorStop(1, colour(swatchA.current))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, W, H)
    ctx.globalAlpha = 0.16
    ctx.fillStyle = colour(swatchC.current)
    for (let x = -H; x < W + H; x += 36) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x + 14, 0)
      ctx.lineTo(x + 14 - H, H)
      ctx.lineTo(x - H, H)
      ctx.closePath()
      ctx.fill()
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'destination-out'
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = BRUSH
    drawing.current = false
    last.current = null
    moves.current = 0
    stroked.current = false
    clearedRef.current = false
    setCleared(false)
    setFoilGone(false)
    setHintGone(false)
  }, [])

  // Paint on mount and again after a failed play (resetKey bumps); never over a shown result.
  useEffect(() => {
    if (revealedAtMount.current && resetKey === 0) return
    paintFoil()
  }, [paintFoil, resetKey])

  // A result that arrived without a scratch (loaded from the server) just shows.
  useEffect(() => {
    if (revealed) setFoilGone(true)
  }, [revealed])

  useEffect(() => {
    if (prize && (cleared || autoReveal)) setFoilGone(true)
  }, [prize, cleared, autoReveal])

  useEffect(() => {
    if (!foilGone || !prize || revealed) return
    const t = window.setTimeout(() => onLandedRef.current(), reducedMotion ? 220 : 520)
    return () => window.clearTimeout(t)
  }, [foilGone, prize, revealed, reducedMotion])

  const toCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - rect.left) * W) / rect.width, y: ((e.clientY - rect.top) * H) / rect.height }
  }

  const eraseAt = (p: { x: number; y: number }, from: { x: number; y: number } | null) => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.beginPath()
    ctx.moveTo(from?.x ?? p.x, from?.y ?? p.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(p.x, p.y, BRUSH / 2, 0, Math.PI * 2)
    ctx.fill()
  }

  const checkCleared = () => {
    if (clearedRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    let clear = 0
    let total = 0
    for (let i = 3; i < data.length; i += 32) {
      total++
      if (data[i] < 128) clear++
    }
    if (total && clear / total >= THRESHOLD) {
      clearedRef.current = true
      setCleared(true)
    }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!scratchable || foilGone) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = toCanvas(e)
    eraseAt(p, null)
    last.current = p
    setHintGone(true)
    if (!stroked.current) {
      stroked.current = true
      onFirstStroke()
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const p = toCanvas(e)
    eraseAt(p, last.current)
    last.current = p
    if (++moves.current % 6 === 0) checkCleared()
  }

  const endStroke = () => {
    if (!drawing.current) return
    drawing.current = false
    last.current = null
    checkCleared()
  }

  return (
    <div className="relative mx-auto w-[320px] max-w-full">
      <div
        role="img"
        aria-label={prize && foilGone ? `Scratch card: ${prize.prizeLabel}` : 'Scratch card'}
        className="relative aspect-[8/5] w-full select-none overflow-hidden rounded-2xl border border-border-default bg-surface-elevated shadow-lg"
      >
        <span ref={swatchA} aria-hidden="true" className="absolute h-0 w-0 overflow-hidden text-accent-400" />
        <span ref={swatchB} aria-hidden="true" className="absolute h-0 w-0 overflow-hidden text-accent-600" />
        <span ref={swatchC} aria-hidden="true" className="absolute h-0 w-0 overflow-hidden text-primary-300" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-6 text-center">
          {prize ? (
            <>
              <span className="text-primary-500 text-[10px] font-black uppercase tracking-[0.2em]">You got</span>
              <span className="text-2xl font-black leading-tight text-foreground">{prize.prizeLabel}</span>
            </>
          ) : (
            <span className="text-5xl font-black text-foreground-muted opacity-40">?</span>
          )}
        </div>
        <motion.div
          initial={false}
          animate={{ opacity: foilGone ? 0 : 1 }}
          transition={{ duration: reducedMotion ? 0.2 : 0.5 }}
          className={`absolute inset-0 ${foilGone ? 'pointer-events-none' : ''}`}
        >
          <canvas
            ref={canvasRef}
            width={W}
            height={H}
            className={`h-full w-full touch-none ${scratchable ? 'cursor-crosshair' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            onLostPointerCapture={endStroke}
          />
          {!hintGone && !reducedMotion && (
            <span className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs font-bold uppercase tracking-wider text-white/90">
              Scratch to reveal
            </span>
          )}
        </motion.div>
      </div>
      {reducedMotion && canPlay && !foilGone && (
        <button
          type="button"
          onClick={onReveal}
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border-default bg-surface-elevated px-5 py-2.5 text-sm font-bold text-foreground shadow-lg transition-colors hover:border-accent-400"
        >
          Reveal
        </button>
      )}
    </div>
  )
}

// ---- Confetti ------------------------------------------------------------------------------------

interface Particle {
  id: number
  x: number
  y: number
  rotate: number
  size: number
  colour: string
  round: boolean
  delay: number
}

const CONFETTI_COLOURS = [
  'bg-accent-500',
  'bg-accent-400',
  'bg-accent-300',
  'bg-primary-500',
  'bg-primary-400',
  'bg-primary-300',
]

function makeParticles(): Particle[] {
  const count = 24 + Math.floor(Math.random() * 17)
  return Array.from({ length: count }, (_, id) => {
    const angle = Math.random() * Math.PI * 2
    const dist = 80 + Math.random() * 110
    return {
      id,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist + 70,
      rotate: (Math.random() - 0.5) * 720,
      size: 6 + Math.random() * 5,
      colour: CONFETTI_COLOURS[id % CONFETTI_COLOURS.length],
      round: Math.random() < 0.4,
      delay: Math.random() * 0.1,
    }
  })
}

function Confetti({ particles }: { particles: Particle[] }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {particles.map(p => (
        <motion.span
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1, rotate: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.6, rotate: p.rotate }}
          transition={{ duration: 1.2, ease: 'easeOut', delay: p.delay }}
          className={`absolute left-1/2 top-1/2 ${p.colour} ${p.round ? 'rounded-full' : 'rounded-sm'}`}
          style={{ width: p.size, height: p.size, marginLeft: -p.size / 2, marginTop: -p.size / 2 }}
        />
      ))}
    </div>
  )
}
