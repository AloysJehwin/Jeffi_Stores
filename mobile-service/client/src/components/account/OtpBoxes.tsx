import { useEffect, useState, type Ref } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated'

// Six digit boxes drawn under a real, transparent TextInput that spans them: the input keeps
// one-time-code autofill, paste and the number pad; the boxes only show its value.

export function OtpBoxes({
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

  useEffect(() => {
    if (!shake) return
    offset.value = withSequence(
      withTiming(-8, { duration: 45 }),
      withTiming(8, { duration: 45 }),
      withTiming(-5, { duration: 45 }),
      withTiming(0, { duration: 45 })
    )
  }, [shake, offset])

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
              className={`h-14 flex-1 items-center justify-center rounded-2xl border-2 ${
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
        style={[StyleSheet.absoluteFill, { opacity: 0 }]}
      />
    </Animated.View>
  )
}

function Caret() {
  const opacity = useSharedValue(1)
  useEffect(() => {
    opacity.value = withRepeat(withSequence(withTiming(0, { duration: 500 }), withTiming(1, { duration: 500 })), -1, false)
  }, [opacity])
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }))
  return <Animated.View style={style} className="h-7 w-0.5 rounded-full bg-accent-500" />
}
