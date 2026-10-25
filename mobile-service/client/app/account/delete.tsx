import { useState } from 'react'
import { Linking, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Trash2, TriangleAlert } from 'lucide-react-native'
import { useRequireAuth, useSignOut } from '../../src/components/account/hooks'
import { checkAccountDeletion, deleteAccount, type DeletionBlocker } from '../../src/api/account'
import { BodySmall, Button, Card, confirm, notify, Notice, Screen, Skeleton, Text, TextButton, TextField } from '../../src/ui'

// Account deletion, as on the web account page (controller-service components/visitor/account/DeleteAccountCard.tsx).

const DELETED = ['Profile, phone and date of birth', 'Saved addresses', 'Cart and wishlist', 'Reviews and their photos', 'Loyalty points and referrals', 'Search history and sign-in sessions']

export default function DeleteAccountScreen() {
  useRequireAuth()
  const router = useRouter()
  const signOut = useSignOut()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [late, setLate] = useState<DeletionBlocker[]>([])
  const { data, isLoading } = useQuery({ queryKey: ['account-deletion'], queryFn: checkAccountDeletion })
  const blockers = late.length ? late : data?.blockers || []
  const ready = typed === 'DELETE' && !blockers.length && !busy

  async function askToDelete() {
    if (await confirm({ title: 'Delete your account?', message: 'This cannot be undone.', confirmLabel: 'Delete', destructive: true })) run()
  }

  async function run() {
    setBusy(true)
    try {
      const res = await deleteAccount()
      if (!res.ok) {
        if (res.data.blockers) setLate(res.data.blockers)
        notify('Could not delete your account', res.data.error || 'Please try again.')
        return
      }
      await signOut()
      router.replace('/')
      notify('Account deleted', 'Your account and personal data have been deleted.')
    } catch {
      notify('Network error', 'Please check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Screen title="Delete account" mode="keyboard" contentClassName="gap-4">
      <Card className="gap-3">
        <BodySmall>This permanently deletes:</BodySmall>
        <View className="gap-1.5">
          {DELETED.map(item => (
            <View key={item} className="flex-row gap-2">
              <Text className="text-sm text-foreground-muted">•</Text>
              <Text className="flex-1 text-sm text-foreground">{item}</Text>
            </View>
          ))}
        </View>
        {!!data?.retainedOrders && (
          <BodySmall>
            Your {data.retainedOrders} order{data.retainedOrders > 1 ? 's' : ''} and invoices stay on record for tax law, without your email or phone.
          </BodySmall>
        )}
        <TextButton label="Read the full policy" onPress={() => Linking.openURL('https://jeffistores.in/legal/account-deletion')} />
      </Card>

      {isLoading ? (
        // The confirm step: field label, input, button.
        <View className="gap-3">
          <Skeleton height={13} width={150} />
          <Skeleton height={56} rounded="rounded-field" />
          <Skeleton height={56} rounded="rounded-field" />
        </View>
      ) : blockers.length ? (
        <Notice tone="warning" icon={TriangleAlert}>
          <View className="gap-1">
            {blockers.map(b => (
              <Text key={b.kind} className="text-sm leading-5 text-orange-800 dark:text-orange-300">
                {b.message}
              </Text>
            ))}
          </View>
        </Notice>
      ) : (
        <View className="gap-4">
          <TextField label="Type DELETE to confirm" value={typed} onChangeText={setTyped} autoCapitalize="characters" autoCorrect={false} placeholder="DELETE" />
          <Button label="Delete my account" icon={Trash2} variant="destructive" loading={busy} disabled={!ready} haptics onPress={askToDelete} />
        </View>
      )}
    </Screen>
  )
}
