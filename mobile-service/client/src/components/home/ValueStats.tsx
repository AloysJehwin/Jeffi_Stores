import { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Dimensions, Text, View } from 'react-native'
import { Grid } from './layout'
import type { SectionProps, ValueStat } from '../../types/home'

// Mirror of controller-service components/visitor/home/ValueStats.tsx.

const DURATION_MS = 1200
const POLL_MS = 200

/** homepage-sections friendlyCount: rounds down to a figure that stays true with a "+" (1,234 → 1,200+). */
function friendlyCount(n: number): string {
  const step = n >= 1000 ? 100 : n >= 100 ? 10 : 1
  const floored = Math.floor(n / step) * step
  return `${floored.toLocaleString('en-IN')}${step > 1 ? '+' : ''}`
}

export default function ValueStats({ section, data }: SectionProps) {
  const stats = (data.extras[section.id] as ValueStat[] | undefined) ?? []
  const ref = useRef<View>(null)
  // Final figures first; the count-up only replays for a band still below the fold (30% visible starts it).
  const [progress, setProgress] = useState(1)
  const armed = useRef(false)
  const timers = useRef<{ poll?: ReturnType<typeof setInterval>; frame?: number; dead?: boolean }>({})

  useEffect(() => {
    const t = timers.current
    return () => {
      t.dead = true
      if (t.poll) clearInterval(t.poll)
      if (t.frame) cancelAnimationFrame(t.frame)
    }
  }, [])

  const countUp = useCallback(() => {
    const t = timers.current
    const start = Date.now()
    const tick = () => {
      if (t.dead) return
      const k = Math.min(1, (Date.now() - start) / DURATION_MS)
      setProgress(1 - Math.pow(1 - k, 3))
      if (k < 1) t.frame = requestAnimationFrame(tick)
    }
    t.frame = requestAnimationFrame(tick)
  }, [])

  const onLayout = useCallback(async () => {
    if (armed.current) return
    armed.current = true
    if (await AccessibilityInfo.isReduceMotionEnabled()) return
    const t = timers.current
    ref.current?.measureInWindow((_x, y) => {
      if (t.dead || y < Dimensions.get('window').height) return
      setProgress(0)
      t.poll = setInterval(() => {
        ref.current?.measureInWindow((_x2, top, _w, h) => {
          if (t.dead) return
          // Unmeasurable (collapsed) view: show the final figures rather than a stuck 0.
          if (h <= 0) {
            clearInterval(t.poll)
            t.poll = undefined
            setProgress(1)
            return
          }
          const visible = Math.min(top + h, Dimensions.get('window').height) - Math.max(top, 0)
          if (visible / h < 0.3) return
          clearInterval(t.poll)
          t.poll = undefined
          countUp()
        })
      }, POLL_MS)
    })
  }, [countUp])

  if (stats.length === 0) return null

  return (
    <View ref={ref} collapsable={false} onLayout={onLayout} className="bg-surface px-4 py-12">
      <View className="mb-8 items-center">
        <Text className="mb-1 text-center text-[10px] font-black uppercase text-primary-500" style={{ letterSpacing: 2 }}>
          {section.copy.eyebrow ?? 'By the numbers'}
        </Text>
        <Text className="text-center text-2xl font-black text-foreground" style={{ letterSpacing: -0.6 }}>
          {section.copy.title ?? 'Trusted by our customers'}
        </Text>
      </View>
      <Grid cols={2} gap={16}>
        {stats.map(s => (
          <View key={s.metric} className="flex-1 rounded-2xl border border-border-default bg-surface-elevated p-5">
            <Text
              className="text-center text-3xl font-black text-primary-600 dark:text-primary-400"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {progress >= 1 ? friendlyCount(s.value) : Math.round(s.value * progress).toLocaleString('en-IN')}
            </Text>
            <Text
              className="mt-2 text-center text-xs font-semibold uppercase text-foreground-secondary"
              style={{ letterSpacing: 0.3 }}
            >
              {s.label}
            </Text>
          </View>
        ))}
      </Grid>
    </View>
  )
}
