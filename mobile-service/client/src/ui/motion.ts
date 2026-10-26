import { useEffect, useState } from 'react'
import { AccessibilityInfo } from 'react-native'
import { useReducedMotion, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'

export const SPRING = { damping: 18, stiffness: 260 }
export const SHEET_SPRING = { damping: 24, stiffness: 240, mass: 0.9 }

/** `animate` is false when the system asks for less motion; autoplay, pulses and `entering` should check it. */
export function useMotion() {
  const reduced = useReducedMotion()
  return { animate: !reduced, reduced }
}

/** True while VoiceOver / TalkBack is on; content shouldn't move on its own under it. */
export function useScreenReader() {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let live = true
    AccessibilityInfo.isScreenReaderEnabled().then(v => live && setOn(v))
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setOn)
    return () => {
      live = false
      sub.remove()
    }
  }, [])
  return on
}

/** Press-down scale for a Pressable: spread `handlers` on it and `style` on an Animated.View around it. */
export function usePressScale(to = 0.97) {
  const scale = useSharedValue(1)
  const { animate } = useMotion()
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return {
    style,
    handlers: {
      onPressIn: () => {
        if (animate) scale.value = withSpring(to, SPRING)
      },
      onPressOut: () => {
        scale.value = withSpring(1, SPRING)
      },
    },
  }
}

/** `entering` animation only when motion is allowed. */
export function useEntering<T>(animation: T): T | undefined {
  const { animate } = useMotion()
  return animate ? animation : undefined
}
