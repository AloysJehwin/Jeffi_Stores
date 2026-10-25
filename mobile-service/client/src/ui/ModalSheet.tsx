import { useState, type ReactNode } from 'react'
import { Modal, View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { X } from 'lucide-react-native'
import { BottomSheet, SheetFooter } from './BottomSheet'
import { Text } from './Text'
import { IconButton } from './Button'

// A BottomSheet hosted in a native Modal, for sheets opened from deep inside a screen. Android's Modal
// is its own window, so it needs its own gesture root; the Modal stays up until the slide-out ends.

export interface ModalSheetProps {
  open: boolean
  onClose: () => void
  title?: string
  subtitle?: string
  children: ReactNode
  /** Pinned under the scrolling content (actions). */
  footer?: ReactNode
  maxHeightRatio?: number
}

export function ModalSheet({ open, onClose, title, subtitle, children, footer, maxHeightRatio }: ModalSheetProps) {
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)
  if (!shown) return null
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <BottomSheet open={open} onClose={onClose} onClosed={() => setShown(false)} maxHeightRatio={maxHeightRatio}>
          {title ? <SheetHeader title={title} subtitle={subtitle} onClose={onClose} /> : null}
          {children}
          {footer ? <SheetFooter>{footer}</SheetFooter> : null}
        </BottomSheet>
      </GestureHandlerRootView>
    </Modal>
  )
}

export function SheetHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose?: () => void }) {
  return (
    <View className="mb-4 flex-row items-start gap-3 pt-1">
      <View className="flex-1">
        <Text accessibilityRole="header" className="font-display text-xl font-extrabold text-foreground">
          {title}
        </Text>
        {subtitle ? <Text className="mt-1 text-sm leading-5 text-foreground-secondary">{subtitle}</Text> : null}
      </View>
      {onClose ? <IconButton icon={X} label="Close" variant="tinted" size="sm" onPress={onClose} /> : null}
    </View>
  )
}
