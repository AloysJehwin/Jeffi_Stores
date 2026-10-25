import type { ReactNode } from 'react'
import { Modal, Pressable, View } from 'react-native'
import { useMotion } from './motion'

/** A full-screen layer in its own window (the search panel): a dimmed backdrop that closes it, children on top. */
export function Overlay({ open, onClose, closeLabel = 'Close', children }: { open: boolean; onClose: () => void; closeLabel?: string; children: ReactNode }) {
  const { animate } = useMotion()
  return (
    <Modal visible={open} transparent animationType={animate ? 'fade' : 'none'} statusBarTranslucent onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable className="absolute inset-0 bg-black/40" onPress={onClose} accessibilityLabel={closeLabel} />
        {children}
      </View>
    </Modal>
  )
}
