import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import Animated, { FadeIn, FadeInLeft, FadeInRight, ZoomIn } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import HeroIcon from '../components/account/HeroIcon'
import { BottomSheet } from './BottomSheet'
import { useTokens } from '../theme'

// The app's date picker: a sheet with a day calendar plus month and year grids (the web DatePicker's
// three views), in its own Modal so it also opens over other modals. Dates are YYYY-MM-DD strings.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEK = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const CELL = 44
const WEEK_ROW = 28
const BODY = WEEK_ROW + CELL * 6
const YEAR_ROW = 48
const YEAR_GAP = 10

type Mode = 'day' | 'month' | 'year'
type Ymd = { y: number; m: number; d: number }

const pad = (n: number) => String(n).padStart(2, '0')
const toIso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

function parseIso(v: string | undefined): Ymd | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '')
  if (!r) return null
  const [y, m, d] = [Number(r[1]), Number(r[2]) - 1, Number(r[3])]
  return m >= 0 && m < 12 && d >= 1 && d <= daysIn(y, m) ? { y, m, d } : null
}

/** "12 Mar 1994", "Sat, 12 Mar 1994" or "Saturday, 12 March 1994". */
export function formatDate(v: string, style: 'short' | 'medium' | 'long' = 'short'): string {
  const p = parseIso(v)
  if (!p) return ''
  const month = style === 'long' ? MONTHS[p.m] : MONTHS[p.m].slice(0, 3)
  const base = `${p.d} ${month} ${p.y}`
  if (style === 'short') return base
  const wd = DAY_NAMES[new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay()]
  return `${style === 'long' ? wd : wd.slice(0, 3)}, ${base}`
}

type PickerProps = {
  value: string
  onChange: (v: string) => void
  title: string
  min?: string
  max?: string
  /** Where the calendar opens while there is no value. */
  defaultView?: string
  /** First view while there is no value: a date of birth starts at the year. */
  startWith?: 'day' | 'year'
}

/** A pressable field that opens the picker; `children` draws the field (it gets whether the sheet is open). */
export function DateField({ children, ...props }: PickerProps & { children: (open: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Pressable
        onPress={() => {
          Keyboard.dismiss()
          setOpen(true)
        }}
        accessibilityRole="button"
        accessibilityLabel={`${props.title}, ${props.value ? formatDate(props.value, 'long') : 'not set'}`}
        accessibilityHint="Opens a calendar"
      >
        {children(open)}
      </Pressable>
      <DatePickerSheet {...props} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

export function DatePickerSheet({ open, onClose, ...props }: PickerProps & { open: boolean; onClose: () => void }) {
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)
  if (!shown) return null
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      {/* Gestures inside an Android Modal need their own root. */}
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheet open={open} onClose={onClose} onClosed={() => setShown(false)}>
          <Picker {...props} onClose={onClose} />
        </BottomSheet>
      </GestureHandlerRootView>
    </Modal>
  )
}

function Picker({ value, onChange, title, min, max, defaultView, startWith = 'day', onClose }: PickerProps & { onClose: () => void }) {
  const t = useTokens()
  const insets = useSafeAreaInsets()
  const now = new Date()
  const todayIso = toIso(now.getFullYear(), now.getMonth(), now.getDate())
  const minIso = parseIso(min) ? (min as string) : toIso(now.getFullYear() - 100, 0, 1)
  const maxIso = parseIso(max) ? (max as string) : toIso(now.getFullYear() + 10, 11, 31)
  const lo = parseIso(minIso) as Ymd
  const hi = parseIso(maxIso) as Ymd

  const initial = parseIso(value)
  const anchor = (() => {
    const a = initial ?? parseIso(defaultView) ?? parseIso(todayIso)!
    const iso = toIso(a.y, a.m, Math.min(a.d, daysIn(a.y, a.m)))
    return iso < minIso ? lo : iso > maxIso ? hi : a
  })()
  const [sel, setSel] = useState(initial ? value : '')
  const [view, setView] = useState({ y: anchor.y, m: anchor.m })
  const [mode, setMode] = useState<Mode>(initial ? 'day' : startWith)
  const [dir, setDir] = useState<1 | -1 | 0>(0)
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (closing.current) clearTimeout(closing.current)
  }, [])

  const tick = () => Haptics.selectionAsync().catch(() => {})
  const monthOff = (y: number, m: number) => toIso(y, m, daysIn(y, m)) < minIso || toIso(y, m, 1) > maxIso
  const prev = view.m === 0 ? { y: view.y - 1, m: 11 } : { y: view.y, m: view.m - 1 }
  const next = view.m === 11 ? { y: view.y + 1, m: 0 } : { y: view.y, m: view.m + 1 }
  const canPrev = !monthOff(prev.y, prev.m)
  const canNext = !monthOff(next.y, next.m)

  const pickYear = (y: number) => {
    tick()
    const m = !monthOff(y, view.m) ? view.m : y <= lo.y ? lo.m : hi.m
    setView({ y, m })
    setDir(0)
    setMode('month')
  }
  const pickMonth = (m: number) => {
    tick()
    setView(v => ({ ...v, m }))
    setDir(0)
    setMode('day')
  }
  const pickDay = (d: number) => {
    const iso = toIso(view.y, view.m, d)
    if (iso < minIso || iso > maxIso) return
    tick()
    setSel(iso)
    onChange(iso)
    // Long enough to see the day light up.
    if (closing.current) clearTimeout(closing.current)
    closing.current = setTimeout(onClose, 180)
  }
  const go = (step: 1 | -1) => {
    const to = step === 1 ? next : prev
    if (monthOff(to.y, to.m)) return
    setDir(step)
    setView(to)
  }

  const hint = mode === 'year' ? 'Pick the year' : mode === 'month' ? 'Pick the month' : 'Pick the day'
  return (
    <View style={{ paddingBottom: insets.bottom + 4 }}>
      <View className="flex-row items-start gap-3 pt-1">
        <View className="flex-1">
          <Text className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{title}</Text>
          <Text numberOfLines={1} className={`mt-1 text-[22px] font-black leading-7 tracking-tight ${sel ? 'text-foreground' : 'text-foreground-secondary'}`}>
            {sel ? formatDate(sel, 'medium') : hint}
          </Text>
        </View>
        <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close" className="h-9 w-9 items-center justify-center rounded-full bg-surface-secondary">
          <HeroIcon name="x" size={18} color={t.foregroundSecondary} />
        </Pressable>
      </View>

      <View className="mt-4 flex-row items-center gap-2">
        <ModeChip label={MONTHS[view.m]} active={mode === 'month'} onPress={() => setMode(mode === 'month' ? 'day' : 'month')} />
        <ModeChip label={String(view.y)} active={mode === 'year'} onPress={() => setMode(mode === 'year' ? 'day' : 'year')} />
        <View className="flex-1" />
        {mode === 'day' ? (
          <>
            <RoundButton icon="chevronLeft" label="Previous month" disabled={!canPrev} onPress={() => go(-1)} />
            <RoundButton icon="chevronRight" label="Next month" disabled={!canNext} onPress={() => go(1)} />
          </>
        ) : null}
      </View>

      <View style={{ height: BODY }} className="mt-3 overflow-hidden">
        {mode === 'day' ? (
          <Animated.View key={`${view.y}-${view.m}`} entering={(dir === 1 ? FadeInRight : dir === -1 ? FadeInLeft : FadeIn).duration(200)}>
            <DayGrid y={view.y} m={view.m} sel={sel} today={todayIso} minIso={minIso} maxIso={maxIso} onPick={pickDay} />
          </Animated.View>
        ) : mode === 'month' ? (
          <Animated.View key="month" entering={FadeIn.duration(180)} className="flex-1 gap-2.5 pt-1">
            {[0, 1, 2, 3].map(r => (
              <View key={r} className="flex-1 flex-row gap-2.5">
                {[0, 1, 2].map(c => {
                  const i = r * 3 + c
                  const on = !!sel && sel.startsWith(`${view.y}-${pad(i + 1)}`)
                  return (
                    <Tile
                      key={i}
                      label={MONTHS[i].slice(0, 3)}
                      a11y={`${MONTHS[i]} ${view.y}`}
                      on={on}
                      current={!on && i === view.m}
                      disabled={monthOff(view.y, i)}
                      onPress={() => pickMonth(i)}
                    />
                  )
                })}
              </View>
            ))}
          </Animated.View>
        ) : (
          <Animated.View key="year" entering={FadeIn.duration(180)} className="flex-1">
            <YearGrid from={lo.y} to={hi.y} view={view.y} sel={parseIso(sel)?.y ?? null} onPick={pickYear} />
          </Animated.View>
        )}
      </View>
    </View>
  )
}

function DayGrid({
  y,
  m,
  sel,
  today,
  minIso,
  maxIso,
  onPick,
}: {
  y: number
  m: number
  sel: string
  today: string
  minIso: string
  maxIso: string
  onPick: (d: number) => void
}) {
  const lead = new Date(Date.UTC(y, m, 1)).getUTCDay()
  const cells: (number | null)[] = Array.from({ length: 42 }, (_, i) => {
    const d = i - lead + 1
    return d >= 1 && d <= daysIn(y, m) ? d : null
  })
  return (
    <View>
      <View className="flex-row">
        {WEEK.map(w => (
          <Text key={w} className="flex-1 text-center text-xs font-semibold text-foreground-muted" style={{ lineHeight: WEEK_ROW }}>
            {w}
          </Text>
        ))}
      </View>
      {[0, 1, 2, 3, 4, 5].map(r => (
        <View key={r} className="flex-row">
          {cells.slice(r * 7, r * 7 + 7).map((d, c) => {
            if (d == null) return <View key={c} className="flex-1" style={{ height: CELL }} />
            const iso = toIso(y, m, d)
            const on = iso === sel
            const off = iso < minIso || iso > maxIso
            const isToday = iso === today
            return (
              <Pressable
                key={c}
                onPress={() => onPick(d)}
                disabled={off}
                accessibilityRole="button"
                accessibilityLabel={`${d} ${MONTHS[m]} ${y}`}
                accessibilityState={{ selected: on, disabled: off }}
                className="flex-1 items-center justify-center"
                style={{ height: CELL }}
              >
                {({ pressed }) => (
                  <View
                    className={`h-10 w-10 items-center justify-center rounded-full ${
                      isToday && !on ? 'border-2 border-accent-500' : ''
                    } ${pressed && !on ? 'bg-accent-50 dark:bg-accent-900/30' : ''}`}
                  >
                    {on ? <Animated.View entering={ZoomIn.duration(180)} className="absolute h-10 w-10 rounded-full bg-accent-500" /> : null}
                    <Text
                      className={`text-[15px] ${
                        on
                          ? 'font-bold text-white'
                          : off
                            ? 'text-foreground-muted opacity-40'
                            : isToday
                              ? 'font-bold text-accent-600 dark:text-accent-400'
                              : 'font-medium text-foreground'
                      }`}
                    >
                      {d}
                    </Text>
                  </View>
                )}
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

function YearGrid({ from, to, view, sel, onPick }: { from: number; to: number; view: number; sel: number | null; onPick: (y: number) => void }) {
  const ref = useRef<ScrollView>(null)
  const jumped = useRef(false)
  const years = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  const rows = Array.from({ length: Math.ceil(years.length / 4) }, (_, r) => years.slice(r * 4, r * 4 + 4))
  const offset = Math.max(0, Math.floor((view - from) / 4) * (YEAR_ROW + YEAR_GAP) - (BODY - YEAR_ROW) / 2)
  return (
    <ScrollView
      ref={ref}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ gap: YEAR_GAP, paddingVertical: 4 }}
      onContentSizeChange={() => {
        if (jumped.current) return
        jumped.current = true
        ref.current?.scrollTo({ y: offset, animated: false })
      }}
    >
      {rows.map(row => (
        <View key={row[0]} className="flex-row gap-2.5" style={{ height: YEAR_ROW }}>
          {row.map(y => (
            <Tile key={y} label={String(y)} a11y={String(y)} on={y === sel} current={y !== sel && y === view} onPress={() => onPick(y)} />
          ))}
          {Array.from({ length: 4 - row.length }, (_, i) => (
            <View key={`pad-${i}`} className="flex-1" />
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

function Tile({ label, a11y, on, current, disabled, onPress }: { label: string; a11y: string; on: boolean; current: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: on, disabled: !!disabled }}
      className={`flex-1 items-center justify-center rounded-2xl ${
        on
          ? 'bg-accent-500'
          : current
            ? 'border-2 border-accent-500 bg-accent-50 dark:bg-accent-900/20'
            : 'border border-border-default bg-surface active:bg-surface-secondary'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <Text className={`text-[15px] ${on ? 'font-bold text-white' : current ? 'font-bold text-accent-700 dark:text-accent-300' : 'font-semibold text-foreground'}`}>
        {label}
      </Text>
    </Pressable>
  )
}

function ModeChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const t = useTokens()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded: active }}
      className={`h-10 flex-row items-center gap-1.5 rounded-full border-2 px-4 ${active ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-border-secondary bg-surface'}`}
    >
      <Text className={`text-[15px] font-bold ${active ? 'text-accent-700 dark:text-accent-300' : 'text-foreground'}`}>{label}</Text>
      <View style={{ transform: [{ rotate: active ? '180deg' : '0deg' }] }}>
        <HeroIcon name="chevronDown" size={14} color={t.foregroundMuted} strokeWidth={2.5} />
      </View>
    </Pressable>
  )
}

function RoundButton({ icon, label, disabled, onPress }: { icon: 'chevronLeft' | 'chevronRight'; label: string; disabled: boolean; onPress: () => void }) {
  const t = useTokens()
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={`h-10 w-10 items-center justify-center rounded-full bg-surface-secondary ${disabled ? 'opacity-40' : 'active:opacity-70'}`}
    >
      <HeroIcon name={icon} size={18} color={t.foreground} strokeWidth={2.5} />
    </Pressable>
  )
}
