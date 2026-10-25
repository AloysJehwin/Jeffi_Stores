import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardScroll } from '../../src/ui/KeyboardScroll'
import TopNav from '../../src/components/layout/TopNav'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import ProfileCard from '../../src/components/account/ProfileCard'
import { useRequireAuth } from '../../src/components/account/hooks'

// The Profile section of controller-service app/(storefront)/account/page.tsx, opened for editing.

export default function ProfileScreen() {
  const insets = useSafeAreaInsets()
  useRequireAuth()

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <KeyboardScroll contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <AccountMobileHeader />
        <View className="px-4 pt-4">
          <ProfileCard initialEditing />
        </View>
      </KeyboardScroll>
    </View>
  )
}
