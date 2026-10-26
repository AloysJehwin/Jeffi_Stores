import { createContext, useCallback, useContext, useState } from 'react'
import { useWindowDimensions } from 'react-native'
import { useFocusEffect } from 'expo-router'
import Animated, { measure, runOnJS, useAnimatedReaction, useAnimatedRef, useSharedValue, type SharedValue } from 'react-native-reanimated'

/** The home feed's vertical scroll offset (a UI-thread shared value), for sections that animate as they scroll into view. */
export const HomeScrollContext = createContext<SharedValue<number> | null>(null)

export const useHomeScrollY = () => useContext(HomeScrollContext)

/**
 * Whether a view overlaps the screen while its tab is focused, so a clip plays only then. Put `ref`,
 * `onLayout` and `collapsable={false}` on an Animated.View; outside the home feed it is on while focused.
 * `watch` false (nothing to play) skips the measuring.
 */
export function useOnScreen(watch = true) {
  const scrollY = useHomeScrollY()
  const { height } = useWindowDimensions()
  const ref = useAnimatedRef<Animated.View>()
  const layouts = useSharedValue(0)
  const [visible, setVisible] = useState(!scrollY)
  const [focused, setFocused] = useState(true)
  useFocusEffect(
    useCallback(() => {
      setFocused(true)
      return () => setFocused(false)
    }, [])
  )
  useAnimatedReaction(
    () => {
      if (!scrollY || !watch) return true
      void scrollY.value // re-measure as the feed scrolls
      if (layouts.value === 0) return false
      const m = measure(ref)
      return !!m && m.pageY < height && m.pageY + m.height > 0
    },
    (on, prev) => {
      if (on !== prev) runOnJS(setVisible)(on)
    },
    [scrollY, height, watch]
  )
  const onLayout = useCallback(() => {
    layouts.value += 1
  }, [layouts])
  return { ref, onLayout, onScreen: visible && focused }
}
