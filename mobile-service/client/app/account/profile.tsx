import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native'
import TopNav from '../../src/components/layout/TopNav'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import ProfileCard from '../../src/components/account/ProfileCard'
import { useRequireAuth } from '../../src/components/account/hooks'

// The Profile section of controller-service app/(storefront)/account/page.tsx, opened for editing.

export default function ProfileScreen() {
  useRequireAuth()

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} className="flex-1">
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <AccountMobileHeader />
          <View className="px-4 pt-4">
            <ProfileCard initialEditing />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}
