import { useEffect, useState, type Ref } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'
import { Text } from './Text'
import { useMotion } from './motion'

// Six digit boxes drawn under a real, transparent TextInput that spans them: the input keeps
// one-time-code autofill, paste and the number pad; the boxes only show its value.

export function OtpField({
  value,
  onChange,
  inputRef,
  shake,
  length = 6,
}: {
  value: string
  onChange: (v: string) => void
  inputRef?: Ref<TextInput>
  /** Bump to wobble the row (a wrong code). */
  shake?: number
  length?: number
}) {
  const [focused, setFocused] = useState(false)
  const offset = useSharedValue(0)
  const { animate } = useMotion()

  useEffect(() => {
    if (!shake || !animate) return
    offset.value = withSequence(
      withTiming(-8, { duration: 45 }),
      withTiming(8, { duration: 45 }),
      withTiming(-5, { duration: 45 }),
      withTiming(0, { duration: 45 })
    )
  }, [shake, offset, animate])

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }))
  const activeIndex = Math.min(value.length, length - 1)

  return (
    <Animated.View style={rowStyle}>
      <View className="flex-row gap-2.5">
        {Array.from({ length }).map((_, i) => {
          const digit = value[i] ?? ''
          const active = focused && i === activeIndex && value.length < length
          return (
            <View
              key={i}
              className={`h-14 flex-1 items-center justify-center rounded-field border-2 ${
                active
                  ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20'
                  : digit
                    ? 'border-foreground-muted bg-surface'
                    : 'border-border-secondary bg-surface'
              }`}
            >
              {digit ? <Text className="text-2xl font-bold text-foreground">{digit}</Text> : active ? <Caret /> : null}
            </View>
          )
        })}
      </View>
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={v => onChange(v.replace(/\D/g, '').slice(0, length))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        maxLength={length}
        autoFocus
        caretHidden
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        importantForAutofill="yes"
        accessibilityLabel="Verification code"
        style={[StyleSheet.absoluteFill, { opacity: 0 }]}
      />
    </Animated.View>
  )
}

function Caret() {
  const opacity = useSharedValue(1)
  const { animate } = useMotion()
  useEffect(() => {
    if (!animate) return
    opacity.value = withRepeat(withSequence(withTiming(0, { duration: 500 }), withTiming(1, { duration: 500 })), -1, false)
  }, [opacity, animate])
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return <Animated.View style={style} className="h-7 w-0.5 rounded-full bg-accent-500" />
}
