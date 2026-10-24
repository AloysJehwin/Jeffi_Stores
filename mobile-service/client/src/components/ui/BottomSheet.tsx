import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { BackHandler, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import Animated, { Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// A sheet that springs up from the bottom and drags down to dismiss. Rendered at the root (not in a
// native Modal) so gestures stay inside the app's GestureHandlerRootView and toasts can sit above it.

const SPRING = { damping: 24, stiffness: 240, mass: 0.9 }

const FooterSlot = createContext<(node: ReactNode) => void>(() => {})

/** Pins its children under the sheet's scrolling content; render it anywhere inside the sheet. */
export function SheetFooter({ children }: { children: ReactNode }) {
  const set = useContext(FooterSlot)
  useLayoutEffect(() => {
    set(children)
    return () => set(null)
  }, [children, set])
  return null
}

export function BottomSheet({
  open,
  onClose,
  children,
  maxHeightRatio = 0.92,
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
  maxHeightRatio?: number
}) {
  const { height: winH } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const [mounted, setMounted] = useState(open)
  const [footer, setFooter] = useState<ReactNode>(null)
  const ty = useSharedValue(winH)
  const sheetH = useSharedValue(winH)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (open) {
      // A fresh open starts off-screen; `ty` otherwise keeps the previous sheet's resting height.
      if (!mounted) {
        ty.value = winH
        sheetH.value = winH
      }
      setMounted(true)
      ty.value = withSpring(0, SPRING)
    } else if (mounted) {
      ty.value = withTiming(sheetH.value || winH, { duration: 200 }, done => {
        if (done) runOnJS(setMounted)(false)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!mounted) return
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRef.current()
      return true
    })
    return () => sub.remove()
  }, [mounted])

  const dismiss = () => closeRef.current()

  const pan = Gesture.Pan()
    .hitSlop({ top: 12, bottom: 24 })
    .onUpdate(e => {
      ty.value = Math.max(0, e.translationY)
    })
    .onEnd(e => {
      if (e.translationY > 110 || e.velocityY > 900) {
        ty.value = withTiming(sheetH.value, { duration: 180 }, done => {
          if (done) runOnJS(dismiss)()
        })
      } else {
        ty.value = withSpring(0, SPRING)
      }
    })

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }))
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [0, sheetH.value || winH], [1, 0], Extrapolation.CLAMP),
  }))

  if (!mounted) return null
  return (
    <FooterSlot.Provider value={setFooter}>
    {/* Taps are ignored while the sheet slides away, so a second tap on "Add" can't post twice. */}
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'box-none' : 'none'}>
      <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]} className="bg-black/50">
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Close" />
      </Animated.View>
      {/* The sheet is a flex child pinned to the end, not absolutely positioned: on iOS the avoiding
          view's bottom padding only moves children that take part in layout. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}
        pointerEvents="box-none"
      >
        <Animated.View
          onLayout={e => {
            sheetH.value = e.nativeEvent.layout.height
          }}
          style={[{ maxHeight: winH * maxHeightRatio, flexShrink: 1 }, sheetStyle]}
          className="overflow-hidden rounded-t-[28px] bg-surface-elevated"
        >
          <GestureDetector gesture={pan}>
            <View className="items-center pb-1 pt-3">
              <View className="h-1.5 w-12 rounded-full bg-border-secondary" />
            </View>
          </GestureDetector>
          {/* flexShrink lets the list give way to the footer once the sheet hits its max height. */}
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            style={{ flexShrink: 1 }}
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 16 }}
          >
            {children}
          </ScrollView>
          {footer ? (
            <View className="border-t border-border-default px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
              {footer}
            </View>
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
    </FooterSlot.Provider>
  )
}
