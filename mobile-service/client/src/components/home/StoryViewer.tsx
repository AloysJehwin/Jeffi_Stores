import { useCallback, useEffect, useRef, useState } from 'react'
import { BackHandler, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Button, Gradient, IconButton, Media, Text, haptic, useEntering, useMotion, useVideoAllowed } from '../../ui'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { ShoppingBag, X } from 'lucide-react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeOut,
  ReduceMotion,
  cancelAnimation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { absUrl, openHref } from '../../lib/links'
import { useStoryStore } from '../../stores/storyStore'
import { status } from '../../theme'
import type { StoryGroup } from '../../types/home'

// Full-screen story viewer: tap right for next, left 30% for previous, hold to pause, drag down to close.
// One instance lives at the root (StoryViewerHost); the home rings open it through storyStore.

const CLOSE_DRAG = 120
const CLOSE_VELOCITY = 1200
const PREV_ZONE = 0.3
const SEG_GAP = 4
// A clip's length sets its slide's; if none arrives by then, the slide's own seconds do.
const DURATION_WAIT_MS = 4000
const MAX_CLIP_MS = 60_000

export function StoryViewerHost() {
  const groups = useStoryStore(s => s.groups)
  const index = useStoryStore(s => s.index)
  const seq = useStoryStore(s => s.seq)
  const hydrateSeen = useStoryStore(s => s.hydrateSeen)
  useEffect(() => {
    hydrateSeen()
  }, [hydrateSeen])
  if (groups.length === 0) return null
  return <Viewer key={seq} groups={groups} start={Math.min(index, groups.length - 1)} />
}

function Viewer({ groups, start }: { groups: StoryGroup[]; start: number }) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { reduced: reduceMotion } = useMotion()
  const fadeIn = useEntering(FadeIn.duration(180))
  const fadeOut = useEntering(FadeOut.duration(150))
  const close = useStoryStore(s => s.close)
  const markSeen = useStoryStore(s => s.markSeen)
  const [pos, setPos] = useState({ g: start, s: 0 })
  const posRef = useRef(pos)
  posRef.current = pos
  const group = groups[pos.g]
  const slide = group.slides[Math.min(pos.s, group.slides.length - 1)]
  const slideKey = `${group.id}:${slide.id}`
  const clip = useVideoAllowed() ? absUrl(slide.video) : null

  const progress = useSharedValue(0)
  const dragY = useSharedValue(0)
  const enter = useSharedValue(reduceMotion ? 1 : 0.96)
  const held = useRef(false)
  const [holding, setHolding] = useState(false)

  // How long the slide runs: its seconds, or a clip's length (null while that loads). The first answer
  // for a slide sticks, so a late one doesn't restart its bar; lengths are kept for revisits.
  const lengths = useRef(new Map<string, number>())
  const [timed, setTimed] = useState<{ key: string; ms: number } | null>(null)
  const time = (ms: number) => setTimed(t => (t?.key === slideKey ? t : { key: slideKey, ms }))
  const slideMs = slide.seconds * 1000
  const known = clip ? lengths.current.get(clip) : undefined
  const durationMs = !clip ? slideMs : timed?.key === slideKey ? timed.ms : (known ?? null)
  const onClipDuration = (secs: number) => {
    if (!clip || lengths.current.has(clip)) return
    const ms = Math.min(MAX_CLIP_MS, secs * 1000)
    lengths.current.set(clip, ms)
    time(ms)
  }
  useEffect(() => {
    if (!clip || lengths.current.has(clip)) return
    const t = setTimeout(() => time(slideMs), DURATION_WAIT_MS)
    return () => clearTimeout(t)
  }, [slideKey, clip, slideMs])

  useEffect(() => {
    enter.value = withTiming(1, { duration: 220, easing: Easing.out(Easing.cubic) })
  }, [enter])

  useEffect(() => {
    markSeen(group)
  }, [group, markSeen])

  const prevGroup = useRef(pos.g)
  useEffect(() => {
    if (prevGroup.current === pos.g) return
    prevGroup.current = pos.g
    haptic.tap()
  }, [pos.g])

  // The next image is warm before its slide starts.
  useEffect(() => {
    const next = group.slides[pos.s + 1] ?? groups[pos.g + 1]?.slides[0]
    const uri = next ? absUrl(next.image) : null
    if (uri) Image.prefetch(uri).catch(() => {})
  }, [group, groups, pos])

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close()
      return true
    })
    return () => sub.remove()
  }, [close])

  const run = useRef<(from: number) => void>(() => {})
  const go = useCallback(
    (dir: 1 | -1) => {
      const { g, s } = posRef.current
      if (dir === 1) {
        if (s + 1 < groups[g].slides.length) return setPos({ g, s: s + 1 })
        if (g + 1 < groups.length) return setPos({ g: g + 1, s: 0 })
        return close()
      }
      if (s > 0) return setPos({ g, s: s - 1 })
      if (g > 0) return setPos({ g: g - 1, s: 0 })
      run.current(0) // first slide of all: restart it
    },
    [groups, close]
  )
  const advance = useCallback(() => go(1), [go])

  // The segment is a timer, not decoration: ReduceMotion.Never keeps it from finishing instantly. With
  // reduced motion the slides don't advance on their own; a tap moves on.
  run.current = from => {
    if (reduceMotion) {
      progress.value = 1
      return
    }
    progress.value = from
    if (durationMs == null) return // the clip's length is still loading
    progress.value = withTiming(
      1,
      { duration: Math.max(0, (1 - from) * durationMs), easing: Easing.linear, reduceMotion: ReduceMotion.Never },
      finished => {
        if (finished) runOnJS(advance)()
      }
    )
  }
  // Starts when the slide does, or once its clip's length is known; a finger already down waits for release.
  useEffect(() => {
    if (held.current) progress.value = 0
    else run.current(0)
    return () => cancelAnimation(progress)
  }, [pos.g, pos.s, durationMs, progress])

  const pause = useCallback(() => {
    held.current = true
    setHolding(true)
    cancelAnimation(progress)
  }, [progress])
  const resume = useCallback(() => {
    if (!held.current) return
    held.current = false
    setHolding(false)
    run.current(progress.value)
  }, [progress])

  const shop = () => {
    const url = slide.url
    close()
    openHref(router, url)
  }

  const tap = Gesture.Tap()
    .maxDuration(400)
    .onEnd(e => {
      runOnJS(go)(e.x < width * PREV_ZONE ? -1 : 1)
    })
  const pan = Gesture.Pan()
    .activeOffsetY([-24, 24])
    .failOffsetX([-30, 30])
    .onBegin(() => {
      runOnJS(pause)()
    })
    .onUpdate(e => {
      dragY.value = Math.max(0, e.translationY)
    })
    .onEnd(e => {
      if (e.translationY > CLOSE_DRAG || e.velocityY > CLOSE_VELOCITY) runOnJS(close)()
      else dragY.value = withSpring(0, { damping: 20, stiffness: 220 })
    })
    .onFinalize(() => {
      runOnJS(resume)()
    })
  const gesture = Gesture.Exclusive(pan, tap)

  const sheetStyle = useAnimatedStyle(() => ({
    borderRadius: interpolate(dragY.value, [0, 60], [0, 28], Extrapolation.CLAMP),
    transform: [{ translateY: dragY.value }, { scale: enter.value * interpolate(dragY.value, [0, 400], [1, 0.85], Extrapolation.CLAMP) }],
  }))
  const backdropStyle = useAnimatedStyle(() => ({ opacity: interpolate(dragY.value, [0, 400], [1, 0.3], Extrapolation.CLAMP) }))

  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} style={StyleSheet.absoluteFill}>
      <StatusBar style="light" />
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} className="bg-black" />
      <Animated.View style={[StyleSheet.absoluteFill, sheetStyle]} className="overflow-hidden bg-black">
        <GestureDetector gesture={gesture}>
          <View
            style={StyleSheet.absoluteFill}
            collapsable={false}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={`${group.title}, story ${Math.min(pos.s, group.slides.length - 1) + 1} of ${group.slides.length}`}
            accessibilityActions={[
              { name: 'increment', label: 'Next story' },
              { name: 'decrement', label: 'Previous story' },
            ]}
            onAccessibilityAction={e => go(e.nativeEvent.actionName === 'decrement' ? -1 : 1)}
          >
            <Media
              image={slide.image}
              video={slide.video}
              style={StyleSheet.absoluteFill}
              transition={reduceMotion ? 0 : 150}
              loop={false}
              paused={holding}
              onDuration={onClipDuration}
              onError={() => known == null && time(slideMs)}
            />
            <Scrim top />
            {slide.caption || slide.url ? <Scrim /> : null}
          </View>
        </GestureDetector>

        {/* Chrome sits beside the gesture view, not inside it, so its buttons never read as a tap on the story. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top + 10, paddingHorizontal: 12 }}>
          <Segments count={group.slides.length} active={pos.s} progress={progress} />
          <View className="mt-3 flex-row items-center gap-2.5">
            <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className="h-8 w-8 overflow-hidden rounded-full border border-white/40 bg-black">
              <Image source={{ uri: absUrl(group.cover) ?? group.cover }} style={{ width: 32, height: 32 }} contentFit="cover" />
            </View>
            <Text className="flex-1 text-sm font-bold text-white" numberOfLines={1}>
              {group.title}
            </Text>
            <IconButton icon={X} label="Close" variant="overlay" size="sm" onPress={close} />
          </View>
        </View>

        {slide.caption || slide.url ? (
          <View
            pointerEvents="box-none"
            className="gap-3"
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingBottom: insets.bottom + 20, paddingHorizontal: 20 }}
          >
            {slide.caption ? (
              <Text className="text-base font-semibold leading-6 text-white" numberOfLines={3}>
                {slide.caption}
              </Text>
            ) : null}
            {slide.url ? (
              <Button label={slide.ctaLabel ?? 'Shop'} icon={ShoppingBag} size="md" onPress={shop} />
            ) : null}
          </View>
        ) : null}
      </Animated.View>
    </Animated.View>
  )
}

/** One bar per slide; the active one fills with the slide timer, earlier ones stay full. */
function Segments({ count, active, progress }: { count: number; active: number; progress: SharedValue<number> }) {
  const [rowW, setRowW] = useState(0)
  const segW = count > 0 ? Math.max(0, (rowW - SEG_GAP * (count - 1)) / count) : 0
  return (
    <View className="flex-row" style={{ gap: SEG_GAP }} onLayout={e => setRowW(e.nativeEvent.layout.width)}>
      {Array.from({ length: count }, (_, i) => (
        <Segment key={i} width={segW} state={i < active ? 'done' : i === active ? 'active' : 'todo'} progress={progress} />
      ))}
    </View>
  )
}

function Segment({ width, state, progress }: { width: number; state: 'done' | 'active' | 'todo'; progress: SharedValue<number> }) {
  const fill = useAnimatedStyle(() => ({ width: state === 'active' ? width * progress.value : state === 'done' ? width : 0 }))
  return (
    <View style={{ width }} className="h-[3px] overflow-hidden rounded-full bg-white/30">
      <Animated.View className="h-full rounded-full bg-white" style={fill} />
    </View>
  )
}

/** Dark fade behind the chrome so the title and caption stay readable on bright images. */
function Scrim({ top }: { top?: boolean }) {
  return (
    <Gradient
      dir={top ? 'b' : 't'}
      stops={[[0, status.black, top ? 0.6 : 0.75], [1, status.black, 0]]}
      style={{ left: 0, right: 0, [top ? 'top' : 'bottom']: 0, height: top ? 160 : 220 }}
    />
  )
}
