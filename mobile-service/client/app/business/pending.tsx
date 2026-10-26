import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Clock, XCircle } from 'lucide-react-native'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { useTokens, status as statusColor } from '../../src/theme'
import { Body, Button, Card, Screen, Text, useBottomInset } from '../../src/ui'

// Mirror of controller-service app/(business)/business/pending/page.tsx. A business account that isn't approved
// gets no session, so this page is all it can see; approval is by email, then the user signs in again.

const STEPS = [
  'Our team reviews your business details and GST number.',
  'Once approved, you’ll receive an email notification.',
  'Sign back in to access exclusive business pricing and quote tools.',
]

export default function BusinessPendingScreen() {
  const router = useRouter()
  const bottom = useBottomInset()
  const { status, note } = useLocalSearchParams<{ status?: string; note?: string }>()
  const name = useStoreConfig().identity.name || 'Jeffi Stores'
  const rejected = status === 'rejected'
  const t = useTokens()

  return (
    <Screen title="Business account" contentClassName="pt-6" scrollProps={{ contentContainerStyle: { paddingBottom: bottom + 24 } }}>
      <View className="items-center px-4">
        <View className={`mb-4 h-16 w-16 items-center justify-center rounded-full ${rejected ? 'bg-red-50 dark:bg-red-900/20' : 'bg-accent-50 dark:bg-accent-900/20'}`}>
          {rejected ? <XCircle size={30} color={statusColor.danger} strokeWidth={1.8} /> : <Clock size={30} color={t.accent500} strokeWidth={1.8} />}
        </View>
        <Text accessibilityRole="header" className="text-center font-display text-2xl font-extrabold text-foreground">
          {rejected ? 'Application not approved' : 'Application under review'}
        </Text>
        <Body className="mt-2 text-center text-foreground-secondary">
          {rejected
            ? `Your application to the ${name} Business Partner program wasn’t approved. Contact support if you think this is a mistake.`
            : `Thank you for applying to the ${name} Business Partner program. Our team is reviewing your application and will get back to you within 24–48 hours.`}
        </Body>
        {rejected && !!note && <Body className="mt-3 text-center text-foreground">“{note}”</Body>}
      </View>

      {!rejected && (
        <Card className="mt-6 gap-3">
          <Text className="font-semibold text-foreground">What happens next</Text>
          {STEPS.map((s, i) => (
            <View key={s} className="flex-row gap-3">
              <View className="h-6 w-6 items-center justify-center rounded-full bg-accent-100 dark:bg-accent-900/40">
                <Text className="text-xs font-bold text-accent-700 dark:text-accent-300">{i + 1}</Text>
              </View>
              <Text className="flex-1 text-sm leading-5 text-foreground-secondary">{s}</Text>
            </View>
          ))}
        </Card>
      )}

      <View className="mt-6 gap-3">
        <Button label="Browse products" onPress={() => router.replace('/(tabs)')} />
        {rejected ? (
          <Button label="Contact support" variant="outline" onPress={() => router.push('/info/support')} />
        ) : (
          <Button label="Sign in again" variant="outline" onPress={() => router.replace('/(auth)/business-login')} />
        )}
      </View>
    </Screen>
  )
}
