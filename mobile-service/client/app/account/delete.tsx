import { useState } from 'react'
import { ActivityIndicator, Alert, Linking, Pressable, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardScroll } from '../../src/ui/KeyboardScroll'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import { useRequireAuth, useSignOut } from '../../src/components/account/hooks'
import { checkAccountDeletion, deleteAccount, type DeletionBlocker } from '../../src/api/account'
import { useTokens } from '../../src/theme'

// Account deletion, as on the web account page (controller-service components/visitor/account/DeleteAccountCard.tsx).

const DELETED = ['Profile, phone and date of birth', 'Saved addresses', 'Cart and wishlist', 'Reviews and their photos', 'Loyalty points and referrals', 'Search history and sign-in sessions']

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets()
  useRequireAuth()
  const t = useTokens()
  const router = useRouter()
  const signOut = useSignOut()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [late, setLate] = useState<DeletionBlocker[]>([])
  const { data, isLoading } = useQuery({ queryKey: ['account-deletion'], queryFn: checkAccountDeletion })
  const blockers = late.length ? late : data?.blockers || []
  const ready = typed === 'DELETE' && !blockers.length && !busy

  function confirm() {
    Alert.alert('Delete your account?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ])
  }

  async function run() {
    setBusy(true)
    try {
      const res = await deleteAccount()
      if (!res.ok) {
        if (res.data.blockers) setLate(res.data.blockers)
        Alert.alert('Could not delete your account', res.data.error || 'Please try again.')
        return
      }
      await signOut()
      router.replace('/')
      Alert.alert('Account deleted', 'Your account and personal data have been deleted.')
    } catch {
      Alert.alert('Network error', 'Please check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <KeyboardScroll contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <AccountMobileHeader />
        <View className="px-4 pt-4 gap-4">
          <View className="bg-surface-elevated rounded-xl border border-border-default p-4 gap-3">
            <Text className="text-base font-semibold text-foreground">Delete account</Text>
            <Text className="text-sm text-foreground-secondary">This permanently deletes:</Text>
            <View className="gap-1">
              {DELETED.map(item => (
                <Text key={item} className="text-sm text-foreground">• {item}</Text>
              ))}
            </View>
            {!!data?.retainedOrders && (
              <Text className="text-sm text-foreground-secondary">
                Your {data.retainedOrders} order{data.retainedOrders > 1 ? 's' : ''} and invoices stay on record for tax law, without your email or phone.
              </Text>
            )}
            <Pressable onPress={() => Linking.openURL('https://jeffistores.in/legal/account-deletion')}>
              <Text className="text-sm text-accent-600 dark:text-accent-400">Read the full policy</Text>
            </Pressable>
          </View>

          {isLoading ? (
            <ActivityIndicator color={t.foregroundMuted} />
          ) : blockers.length ? (
            <View className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 gap-1">
              {blockers.map(b => (
                <Text key={b.kind} className="text-sm text-amber-700 dark:text-amber-400">{b.message}</Text>
              ))}
            </View>
          ) : (
            <View className="gap-3">
              <Text className="text-sm text-foreground">Type DELETE to confirm</Text>
              <TextInput
                value={typed}
                onChangeText={setTyped}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="DELETE"
                placeholderTextColor={t.foregroundMuted}
                className="w-full px-4 py-3 rounded-lg bg-surface border border-border-secondary text-foreground"
              />
              <Pressable
                onPress={confirm}
                disabled={!ready}
                className={`w-full items-center py-3 rounded-xl bg-red-600 ${ready ? 'active:bg-red-700' : 'opacity-50'}`}
              >
                {busy ? <ActivityIndicator color="white" /> : <Text className="text-white text-sm font-semibold">Delete my account</Text>}
              </Pressable>
            </View>
          )}
        </View>
      </KeyboardScroll>
    </View>
  )
}
