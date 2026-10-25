import type { ReactNode } from 'react'
import { Modal, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'
import { IconButton } from './Button'
import { Text } from './Text'

/** A full-screen dark viewer for images; the children fill it, with a caption and close button on top. */
export function Lightbox({
  open,
  onClose,
  onShow,
  caption,
  children,
}: {
  open: boolean
  onClose: () => void
  onShow?: () => void
  /** Top-left, e.g. "2 / 5". */
  caption?: string
  children: ReactNode
}) {
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={open} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} onShow={onShow}>
      <View className="flex-1 bg-black/90">
        {children}
        <View pointerEvents="box-none" style={{ top: insets.top + 8 }} className="absolute left-4 right-4 flex-row items-center justify-between">
          {caption ? (
            <View className="rounded-full bg-black/60 px-3 py-1.5">
              <Text className="text-sm font-semibold text-white">{caption}</Text>
            </View>
          ) : (
            <View />
          )}
          <IconButton icon={X} label="Close" variant="overlay" onPress={onClose} />
        </View>
      </View>
    </Modal>
  )
}
