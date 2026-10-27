import { useCallback } from 'react'
import { useFocusEffect } from 'expo-router'
import { Menu } from 'lucide-react-native'
import { useUnreadCount } from '../../hooks/useNotifications'
import { useCartStore } from '../../stores/cartStore'
import { useTokens } from '../../theme'
import { IconButton } from '../../ui'
import { openMenu } from './MenuSheet'

/** The menu (cart, account, help…). There's no bottom tab bar, so every header carries it top right. */
export function MenuButton() {
  const t = useTokens()
  const cartCount = useCartStore(s => s.count)
  const unread = useUnreadCount()
  const refresh = unread.refresh
  useFocusEffect(useCallback(() => refresh(), [refresh]))
  const count = cartCount + unread.count
  return (
    <IconButton
      icon={Menu}
      label="Open menu"
      badge={count}
      accessibilityLabel={count > 0 ? `Open menu, ${cartCount} in cart, ${unread.count} unread` : 'Open menu'}
      color={t.foregroundSecondary}
      onPress={openMenu}
    />
  )
}
