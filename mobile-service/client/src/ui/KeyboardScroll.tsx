import { forwardRef } from 'react'
import { KeyboardAwareScrollView, type KeyboardAwareScrollViewProps, type KeyboardAwareScrollViewRef } from 'react-native-keyboard-controller'

/** A ScrollView that scrolls the focused input above the keyboard, on Android edge-to-edge too. */
export const KeyboardScroll = forwardRef<KeyboardAwareScrollViewRef, KeyboardAwareScrollViewProps>(function KeyboardScroll(props, ref) {
  return <KeyboardAwareScrollView ref={ref} bottomOffset={24} keyboardShouldPersistTaps="handled" {...props} />
})
