import { forwardRef } from 'react'
import type { ScrollView } from 'react-native'
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewProps } from 'react-native-keyboard-controller'

/** A ScrollView that scrolls the focused input above the keyboard, on Android edge-to-edge too. */
export const KeyboardScroll = forwardRef<ScrollView, KeyboardAwareScrollViewProps>(function KeyboardScroll(props, ref) {
  return <KeyboardAwareScrollView ref={ref} bottomOffset={24} keyboardShouldPersistTaps="handled" {...props} />
})
