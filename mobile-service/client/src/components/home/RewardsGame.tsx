import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import * as Haptics from 'expo-haptics'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  ReduceMotion,
  cancelAnimation,
  makeMutable,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import Svg, { Circle, Defs, LinearGradient, Path, Polygon, Rect, Stop, Text as SvgText } from 'react-native-svg'
import { GUTTER } from './layout'
import { postJson } from '../../api/account'
import { Skeleton } from '../../ui'
import { inr } from '../../lib/format'
import { useAuthStore } from '../../stores/authStore'
import { showToast } from '../../stores/toastStore'
import { accent, primary, status, useTokens } from '../../theme'
import type {
  HomeSection,
  RewardGamePlay,
  RewardGameState,
  RewardsGameData,
  RewardsGamePrize,
  SectionProps,
} from '../../types/home'

// The homepage rewards game (spin a wheel or scratch a card for a personal coupon), mirroring the
// server contract in lib/rewards/game.ts: one play per period, the server picks the prize, the
// client only animates towards it.

type PlayResult = { ok: true; play: RewardGamePlay; repeated: boolean }

/** idle → posting (POST in flight) → playing (prize known, wheel spinning / card being scratched) → revealed. */
type Phase = 'idle' | 'posting' | 'playing' | 'revealed'

const COPY = { eyebrow: 'Your reward', title: 'Spin to win', ctaLabel: 'Play now' }
const LIMIT_SUB: Record<RewardsGameData['playLimit'], string> = { once: 'Play once', daily: 'Play once a day', weekly: 'Play once a week' }

const gamePath = (key: string) => `/api/rewards/game/${encodeURIComponent(key)}`

/** 404: the game was unpublished; 401: the stored token no longer signs in. */
async function fetchGameState(key: string): Promise<RewardGameState | 'gone' | 'signed_out'> {
  const res = await postJson<RewardGameState>(gamePath(key), undefined, 'GET')
  if (res.status === 404) return 'gone'
  if (res.status === 401) return 'signed_out'
  if (!res.ok) throw new Error(res.data?.error || 'Could not load your reward')
  return res.data
}

const rupees = (n: number) => `₹${inr(n).replace(/\.00$/, '')}`

/** "10% off (up to ₹150) on orders of ₹500+ · valid till 12 Nov" */
function terms(c: NonNullable<RewardGamePlay['coupon']>): string {
  const off = c.discountType === 'percentage' ? `${c.value}% off${c.maxDiscount ? ` (up to ${rupees(c.maxDiscount)})` : ''}` : `${rupees(c.value)} off`
  const min = c.minPurchase > 0 ? ` on orders of ${rupees(c.minPurchase)}+` : ''
  const till = c.validUntil ? ` · valid till ${new Date(c.validUntil).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''
  return `${off}${min}${till}`
}

function comeBack(limit: RewardsGameData['playLimit'], nextPlayAt: string | null): string {
  if (limit === 'once') return "You've played this one"
  if (nextPlayAt) {
    return `Come back after ${new Date(nextPlayAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`
  }
  return limit === 'daily' ? 'Come back tomorrow' : 'Come back next week'
}

const buzz = (won: boolean) =>
  Haptics.notificationAsync(won ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => {})

export default function RewardsGame({ section, data }: SectionProps) {
  const game = data.extras[section.id] as RewardsGameData | null | undefined
  if (!game || game.prizes.length < 2) return null
  return <GameCard section={section} game={game} />
}

function GameCard({ section, game }: { section: HomeSection; game: RewardsGameData }) {
  const router = useRouter()
  const t = useTokens()
  const qc = useQueryClient()
  const reduceMotion = useReducedMotion()
  const { width } = useWindowDimensions()
  const user = useAuthStore(s => s.user)
  const gid = `rg${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const innerW = width - GUTTER * 2 - 32
  const wheelSize = Math.min(innerW, 300)

  const state = useQuery({
    queryKey: ['reward-game', game.gameKey, user?.id ?? null],
    queryFn: () => fetchGameState(game.gameKey),
    enabled: !!user,
    retry: 0,
  })

  const [phase, setPhase] = useState<Phase>('idle')
  const [play, setPlay] = useState<RewardGamePlay | null>(null)
  const [confetti, setConfetti] = useState(false)
  const playRef = useRef<RewardGamePlay | null>(null)
  const scratchedEnough = useRef(false)

  // Another account: whatever was on screen belonged to the previous one.
  useEffect(() => {
    setPhase('idle')
    setPlay(null)
    playRef.current = null
  }, [user?.id])

  const reveal = (p: RewardGamePlay) => {
    setPhase('revealed')
    const won = p.coupon != null
    buzz(won)
    if (won && !reduceMotion) setConfetti(true)
  }

  const start = async () => {
    if (phase !== 'idle' || !user) return
    setPhase('posting')
    scratchedEnough.current = false
    playRef.current = null
    setPlay(null)
    try {
      const res = await postJson<PlayResult>(`${gamePath(game.gameKey)}/play`, {})
      if (!res.ok || !res.data?.play) throw new Error(res.data?.error || 'Could not play right now')
      const p = res.data.play
      playRef.current = p
      setPlay(p)
      qc.invalidateQueries({ queryKey: ['reward-game', game.gameKey] })
      const onWheel = game.prizes.some(x => x.id === p.prizeId)
      const scratchDone = game.mode === 'scratch' && (scratchedEnough.current || reduceMotion)
      if (res.data.repeated || !onWheel || scratchDone) reveal(p)
      else setPhase('playing')
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Could not play right now', 'error')
      setPhase('idle')
    }
  }

  const onScratchedEnough = () => {
    scratchedEnough.current = true
    if (playRef.current && phase !== 'revealed') reveal(playRef.current)
  }

  if (state.data === 'gone') return null

  const signedIn = !!user && state.data !== 'signed_out'
  const st = typeof state.data === 'object' ? state.data : null
  const loading = signedIn && state.isLoading
  const failed = signedIn && state.isError
  // Already played this period (from the server): just the result, no game.
  const resting = phase === 'idle' && st != null && !st.canPlay
  const result = phase === 'revealed' ? play : resting ? st?.lastPlay ?? null : null
  const showGame = !loading && !failed && !resting
  const winnerIndex = play ? game.prizes.findIndex(p => p.id === play.prizeId) : -1
  const copy = section.copy
  const ctaLabel = copy.ctaLabel ?? COPY.ctaLabel

  let footer: ReactNode = null
  if (!loading && !failed) {
    if (!signedIn) footer = <Cta label="Sign in to play" onPress={() => router.push('/(auth)/login')} />
    else if (result || resting) footer = <ResultCard play={result} limit={game.playLimit} nextPlayAt={st?.nextPlayAt ?? null} />
    else if (game.mode === 'wheel') footer = <Cta label={ctaLabel} busy={phase !== 'idle'} onPress={start} />
    else if (reduceMotion) footer = <Cta label="Reveal" busy={phase !== 'idle'} onPress={start} />
    else footer = <Text className="mt-4 text-center text-xs text-foreground-muted">Scratch sideways across the card to reveal your prize</Text>
  }

  return (
    <View className="bg-surface-secondary px-4 py-10">
      <View className="overflow-hidden rounded-2xl border border-border-default bg-surface-elevated">
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" pointerEvents="none">
          <Defs>
            <LinearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={accent[500]} stopOpacity={0.14} />
              <Stop offset="0.55" stopColor={t.surfaceElevated} stopOpacity={0} />
              <Stop offset="1" stopColor={primary[500]} stopOpacity={0.14} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${gid})`} />
        </Svg>

        <View className="p-4">
          <Text className="text-center text-[10px] font-black uppercase text-primary-500" style={{ letterSpacing: 2 }}>
            {copy.eyebrow ?? COPY.eyebrow}
          </Text>
          <Text className="mt-1 text-center text-2xl font-black text-foreground" style={{ letterSpacing: -0.6 }}>
            {copy.title ?? COPY.title}
          </Text>
          <Text className="mt-1 text-center text-xs font-semibold uppercase text-foreground-muted" style={{ letterSpacing: 0.3 }}>
            {LIMIT_SUB[game.playLimit]}
          </Text>

          {loading ? (
            game.mode === 'wheel' ? (
              <Skeleton width={wheelSize} height={wheelSize} rounded="rounded-full" className="mt-5 self-center" />
            ) : (
              <Skeleton height={SCRATCH_H} rounded="rounded-xl" className="mt-5" />
            )
          ) : null}

          {failed ? (
            <View className="mt-5 items-center rounded-xl border border-border-default bg-surface px-4 py-6">
              <Text className="text-sm text-foreground-secondary">Could not load your reward</Text>
              <Pressable onPress={() => void state.refetch()} className="mt-2 px-2 py-1" accessibilityRole="button">
                <Text className="text-sm font-semibold text-accent-600 dark:text-accent-400">Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {showGame ? (
            game.mode === 'wheel' ? (
              <Wheel
                prizes={game.prizes}
                size={wheelSize}
                phase={phase}
                winnerIndex={winnerIndex}
                reduceMotion={reduceMotion}
                onLanded={() => {
                  if (playRef.current) reveal(playRef.current)
                }}
              />
            ) : (
              <Scratch
                play={play}
                phase={phase}
                enabled={signedIn && phase !== 'revealed' && !reduceMotion}
                onBegin={start}
                onScratchedEnough={onScratchedEnough}
              />
            )
          ) : null}

          {footer}
        </View>

        {confetti ? <Confetti onDone={() => setConfetti(false)} /> : null}
      </View>
    </View>
  )
}

function Cta({ label, onPress, busy }: { label: string; onPress: () => void; busy?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      className={`mt-5 flex-row items-center justify-center gap-2 self-center rounded-xl bg-primary-500 px-8 py-3 active:bg-primary-600 ${busy ? 'opacity-60' : ''}`}
    >
      {busy ? <ActivityIndicator size="small" color={status.white} /> : null}
      <Text className="font-bold text-white">{label}</Text>
    </Pressable>
  )
}

function ResultCard({ play, limit, nextPlayAt }: { play: RewardGamePlay | null; limit: RewardsGameData['playLimit']; nextPlayAt: string | null }) {
  const c = play?.coupon ?? null
  const share = () => Share.share({ message: c?.code ?? '' }).catch(() => showToast('Could not share the code', 'error'))
  return (
    <View className="mt-5 rounded-xl border border-dashed border-border-default bg-surface p-4">
      {play ? (
        <>
          <Text className="text-[10px] font-black uppercase text-foreground-muted" style={{ letterSpacing: 2 }}>
            {c ? 'You won' : 'This time'}
          </Text>
          <Text className="mt-1 text-lg font-black text-foreground">{play.prizeLabel}</Text>
        </>
      ) : null}
      {c ? (
        <>
          <View className="mt-3 flex-row items-center justify-between gap-3">
            <Text className="flex-1 font-mono text-base font-semibold text-foreground" selectable numberOfLines={1}>
              {c.code}
            </Text>
            <Pressable onPress={share} accessibilityRole="button" className="rounded-lg border border-border-default px-3 py-1.5 active:bg-surface-secondary">
              <Text className="text-sm font-medium text-foreground-secondary">Share code</Text>
            </Pressable>
          </View>
          <Text className="mt-2 text-xs text-foreground-secondary">{terms(c)}</Text>
        </>
      ) : null}
      <Text className={`text-xs text-foreground-muted ${play ? 'mt-3' : ''}`}>{comeBack(limit, nextPlayAt)}</Text>
    </View>
  )
}

// ── Wheel ──

const WHEEL_TURNS = 5
const WHEEL_MS = 4500
const WHEEL_JITTER = 0.35

const mod = (a: number, m: number) => ((a % m) + m) % m

/** Point at `deg` clockwise from 12 o'clock on a circle centred at (c, c). */
function polar(c: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180
  return { x: c + r * Math.sin(a), y: c - r * Math.cos(a) }
}

function segmentPath(c: number, r: number, from: number, to: number): string {
  const a = polar(c, r, from)
  const b = polar(c, r, to)
  return `M${c} ${c} L${a.x} ${a.y} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y} Z`
}

function Wheel({
  prizes,
  size,
  phase,
  winnerIndex,
  reduceMotion,
  onLanded,
}: {
  prizes: RewardsGamePrize[]
  size: number
  phase: Phase
  winnerIndex: number
  reduceMotion: boolean
  onLanded: () => void
}) {
  const t = useTokens()
  const n = prizes.length
  const seg = 360 / n
  const c = size / 2
  const r = c - 6
  const fontSize = n > 8 ? 10 : n > 5 ? 12 : 14

  const rotation = useSharedValue(0)
  const glow = useSharedValue(0)
  // Rotation the landing spin ends at (0 while not landing); drives the last-turn ticks.
  const landTarget = useSharedValue(0)
  const spun = useRef(false)
  const aimed = useRef(false)
  const landedCb = useRef(onLanded)
  landedCb.current = onLanded
  const landed = () => landedCb.current()
  const tick = () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})

  useEffect(() => {
    if (phase === 'posting') {
      // Spinning while the server picks; the real spin takes over from wherever this is.
      spun.current = true
      aimed.current = false
      glow.value = 0
      landTarget.value = 0
      if (!reduceMotion) rotation.value = withRepeat(withTiming(rotation.value + 360, { duration: 1400, easing: Easing.linear }), -1)
      return
    }
    if (winnerIndex < 0) {
      if (phase === 'idle' && spun.current) {
        // The play failed: coast to a stop.
        cancelAnimation(rotation)
        if (!reduceMotion) rotation.value = withTiming(rotation.value + 30, { duration: 450, easing: Easing.out(Easing.quad) })
      }
      return
    }
    if (aimed.current) return
    aimed.current = true
    // The pointer is at 12 o'clock. Rotating the wheel by R moves segment i's centre (i·seg + seg/2,
    // clockwise from the top) to centre + R, so it sits under the pointer when R ≡ −centre; the jitter
    // keeps the landing inside the segment but off its centre line.
    const centre = winnerIndex * seg + seg / 2
    const jitter = (Math.random() * 2 - 1) * WHEEL_JITTER * seg
    const rest = mod(jitter - centre, 360)
    cancelAnimation(rotation)
    if (phase === 'revealed') {
      // A repeated play: no spin, just show where it landed.
      rotation.value = rest
      glow.value = 1
      return
    }
    if (reduceMotion) {
      rotation.value = rest
      glow.value = withTiming(1, { duration: 600, reduceMotion: ReduceMotion.Never }, done => {
        if (done) runOnJS(landed)()
      })
      return
    }
    const current = rotation.value
    const target = current + WHEEL_TURNS * 360 + mod(rest - mod(current, 360), 360)
    landTarget.value = target
    rotation.value = withTiming(target, { duration: WHEEL_MS, easing: Easing.out(Easing.cubic) }, done => {
      if (!done) return
      glow.value = withTiming(1, { duration: 250 })
      runOnJS(landed)()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, winnerIndex])

  // A light tick every 60° through the final turn, slowing with the wheel.
  useAnimatedReaction(
    () => (landTarget.value > 0 && rotation.value > landTarget.value - 360 ? Math.floor(rotation.value / 60) : -1),
    (cur, prev) => {
      if (cur >= 0 && prev != null && prev >= 0 && cur !== prev) runOnJS(tick)()
    },
    []
  )

  const wheelStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }))
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }))

  const segments = useMemo(
    () =>
      prizes.map((p, i) => {
        const from = i * seg
        const mid = from + seg / 2
        const pos = polar(c, r * 0.62, mid)
        // Two alternating tints; an odd count gets a third on the last slice so neighbours never match.
        const fill = n % 2 === 1 && i === n - 1 ? primary[400] : i % 2 ? accent[300] : accent[500]
        const label = p.label.length > 12 ? `${p.label.slice(0, 11)}…` : p.label
        return { key: p.id, d: segmentPath(c, r, from, from + seg), fill, label, pos, angle: mid - 90 }
      }),
    [prizes, seg, c, r, n]
  )

  return (
    <View className="mt-5 self-center" style={{ width: size, height: size }} accessibilityLabel="Prize wheel">
      <Animated.View style={[{ width: size, height: size }, wheelStyle]}>
        <Svg width={size} height={size}>
          <Circle cx={c} cy={c} r={r + 3} fill={t.surfaceElevated} stroke={t.border} strokeWidth={2} />
          {segments.map(s => (
            <Path key={s.key} d={s.d} fill={s.fill} stroke={t.surfaceElevated} strokeWidth={2} strokeLinejoin="round" />
          ))}
          {segments.map(s => (
            <SvgText
              key={`${s.key}-label`}
              x={s.pos.x}
              y={s.pos.y}
              dy={fontSize * 0.35}
              fill={accent[900]}
              fontSize={fontSize}
              fontWeight="700"
              textAnchor="middle"
              transform={`rotate(${s.angle} ${s.pos.x} ${s.pos.y})`}
            >
              {s.label}
            </SvgText>
          ))}
          <Circle cx={c} cy={c} r={r * 0.14} fill={t.surfaceElevated} stroke={t.border} strokeWidth={2} />
          <Circle cx={c} cy={c} r={r * 0.05} fill={accent[500]} />
        </Svg>
        {winnerIndex >= 0 ? (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, glowStyle]}>
            <Svg width={size} height={size}>
              <Path
                d={segmentPath(c, r, winnerIndex * seg, (winnerIndex + 1) * seg)}
                fill={status.white}
                fillOpacity={0.35}
                stroke={status.white}
                strokeWidth={3}
                strokeLinejoin="round"
              />
            </Svg>
          </Animated.View>
        ) : null}
      </Animated.View>
      <Svg width={28} height={30} viewBox="0 0 28 30" style={{ position: 'absolute', top: -8, left: c - 14 }} pointerEvents="none">
        <Polygon points="2,2 26,2 14,28" fill={primary[500]} stroke={t.surfaceElevated} strokeWidth={2} strokeLinejoin="round" />
      </Svg>
    </View>
  )
}

// ── Scratch card ──

const COLS = 12
const ROWS = 7
const SCRATCH_H = 190
const REVEAL_AT = 0.55

function Scratch({
  play,
  phase,
  enabled,
  onBegin,
  onScratchedEnough,
}: {
  play: RewardGamePlay | null
  phase: Phase
  enabled: boolean
  onBegin: () => void
  onScratchedEnough: () => void
}) {
  const total = COLS * ROWS
  const [tiles] = useState(() => Array.from({ length: total }, () => makeMutable(1)))
  const [hit] = useState(() => Array.from({ length: total }, () => makeMutable(0)))
  const cardW = useSharedValue(0)
  const cleared = useSharedValue(0)
  const begun = useSharedValue(0)
  const fired = useSharedValue(0)
  const hint = useSharedValue(1)
  const prevPhase = useRef(phase)
  const beginCb = useRef(onBegin)
  beginCb.current = onBegin
  const enoughCb = useRef(onScratchedEnough)
  enoughCb.current = onScratchedEnough
  const begin = () => beginCb.current()
  const enough = () => enoughCb.current()

  useEffect(() => {
    const was = prevPhase.current
    prevPhase.current = phase
    if (phase === 'revealed') {
      hint.value = withTiming(0, { duration: 200 })
      for (const v of tiles) v.value = withTiming(0, { duration: 300 })
      return
    }
    if (phase === 'idle' && was !== 'idle') {
      // The play failed: foil back on, ready for another go.
      begun.value = 0
      fired.value = 0
      cleared.value = 0
      hint.value = withTiming(1, { duration: 200 })
      for (const h of hit) h.value = 0
      for (const v of tiles) v.value = withTiming(1, { duration: 200 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  // Clears the tile under the finger and its eight neighbours (a fat brush).
  const scratchAt = (x: number, y: number) => {
    'worklet'
    const tileW = cardW.value / COLS
    if (tileW <= 0) return
    const col = Math.floor(x / tileW)
    const row = Math.floor(y / (SCRATCH_H / ROWS))
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = row + dr
        const cc = col + dc
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue
        const i = rr * COLS + cc
        if (hit[i].value) continue
        hit[i].value = 1
        tiles[i].value = withTiming(0, { duration: 150 })
        cleared.value += 1
      }
    }
    if (!fired.value && cleared.value >= total * REVEAL_AT) {
      fired.value = 1
      runOnJS(enough)()
    }
  }

  // Activates on sideways movement only, so a vertical swipe over the card still scrolls the page
  // (and never spends the play); the first activation posts the play so the prize is known while scratching.
  const pan = Gesture.Pan()
    .enabled(enabled)
    .maxPointers(1)
    .activeOffsetX([-6, 6])
    .failOffsetY([-14, 14])
    .shouldCancelWhenOutside(false)
    .onStart(e => {
      if (!begun.value) {
        begun.value = 1
        hint.value = withTiming(0, { duration: 200 })
        runOnJS(begin)()
      }
      scratchAt(e.x, e.y)
    })
    .onUpdate(e => {
      scratchAt(e.x, e.y)
    })

  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value }))

  return (
    <GestureDetector gesture={pan}>
      <View
        collapsable={false}
        onLayout={e => {
          cardW.value = e.nativeEvent.layout.width
        }}
        className="mt-5 overflow-hidden rounded-xl border border-border-default bg-surface"
        style={{ height: SCRATCH_H }}
        accessibilityLabel="Scratch card"
      >
        {/* Under the foil: nothing to give away until the server has answered. */}
        <View style={StyleSheet.absoluteFill} className="items-center justify-center px-6">
          {play ? (
            <>
              <Text className="text-[10px] font-black uppercase text-foreground-muted" style={{ letterSpacing: 2 }}>
                {play.coupon ? 'You won' : 'This time'}
              </Text>
              <Text className="mt-1 text-center text-2xl font-black text-foreground" numberOfLines={2}>
                {play.prizeLabel}
              </Text>
              {play.coupon ? (
                <Text className="mt-2 font-mono text-sm font-semibold text-accent-600 dark:text-accent-400">{play.coupon.code}</Text>
              ) : null}
            </>
          ) : (
            <Text className="text-4xl font-black text-foreground-muted">?</Text>
          )}
        </View>
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {Array.from({ length: ROWS }, (_, row) => (
            <View key={row} style={{ flex: 1, flexDirection: 'row' }}>
              {Array.from({ length: COLS }, (_, col) => (
                <Tile key={col} v={tiles[row * COLS + col]} className={(row + col) % 2 ? 'bg-accent-400' : 'bg-accent-500'} />
              ))}
            </View>
          ))}
        </View>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, hintStyle]} className="items-center justify-center">
          <Text className="text-sm font-black uppercase text-accent-900" style={{ letterSpacing: 2 }}>
            Scratch here
          </Text>
        </Animated.View>
      </View>
    </GestureDetector>
  )
}

function Tile({ v, className }: { v: SharedValue<number>; className: string }) {
  const style = useAnimatedStyle(() => ({ opacity: v.value }))
  return <Animated.View className={className} style={[{ flex: 1 }, style]} />
}

// ── Confetti ──

const CONFETTI_COUNT = 30
const CONFETTI_MS = 1200
const CONFETTI_TINTS = ['bg-accent-500', 'bg-accent-300', 'bg-primary-500', 'bg-primary-300', 'bg-accent-700', 'bg-primary-600']

interface Piece {
  angle: number
  dist: number
  spin: number
  size: number
  tint: string
}

function Confetti({ onDone }: { onDone: () => void }) {
  const pieces = useMemo<Piece[]>(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
        angle: Math.random() * Math.PI * 2,
        dist: 90 + Math.random() * 150,
        spin: (Math.random() - 0.5) * 720,
        size: 6 + Math.random() * 5,
        tint: CONFETTI_TINTS[i % CONFETTI_TINTS.length],
      })),
    []
  )
  const progress = useSharedValue(0)
  const doneCb = useRef(onDone)
  doneCb.current = onDone
  const done = () => doneCb.current()
  useEffect(() => {
    progress.value = withTiming(1, { duration: CONFETTI_MS, easing: Easing.out(Easing.quad) }, finished => {
      if (finished) runOnJS(done)()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} className="items-center justify-center">
      {pieces.map((piece, i) => (
        <ConfettiPiece key={i} piece={piece} progress={progress} />
      ))}
    </View>
  )
}

function ConfettiPiece({ piece, progress }: { piece: Piece; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const k = progress.value
    return {
      opacity: 1 - Math.max(0, (k - 0.6) / 0.4),
      transform: [
        { translateX: Math.cos(piece.angle) * piece.dist * k },
        { translateY: Math.sin(piece.angle) * piece.dist * k + 90 * k * k },
        { rotate: `${piece.spin * k}deg` },
      ],
    }
  })
  return <Animated.View className={`absolute rounded-sm ${piece.tint}`} style={[{ width: piece.size, height: piece.size }, style]} />
}
