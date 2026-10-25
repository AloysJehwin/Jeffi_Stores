import { Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react-native'
import { BodySmall, Button, Caption, Card, ErrorState, IconButton, Screen, ScreenHeader, Skeleton, Subheading, Text, TintedIcon } from '../../src/ui'
import { DEFAULT_POLICY_ICON, POLICY_ICONS, openPolicyPdf } from '../../src/components/info/policy'
import { listPolicies } from '../../src/api/info'
import { openHref } from '../../src/lib/links'

// Mirror of controller-service app/(marketing)/legal/page.tsx at the mobile breakpoint.

const SUBSCRIPTION_TERMS = [
  'Subscriptions renew automatically each cycle through a Razorpay payment mandate (UPI Autopay, card or e-mandate) until you cancel, up to ₹15,000 per cycle.',
  'Pause, resume or cancel any time from My subscriptions. Cancellation takes effect at the end of the current cycle; you are not charged again.',
  'A charged cycle of a digital subscription is non-refundable once access is granted.',
  'Each delivered cycle of a physical subscription follows the Return & Refund Policy.',
  'The mandate shows the payment collector\'s name: "Jeffi" where the store collects through the Jeffi Commerce platform, otherwise the store\'s own name.',
]

// Policy cards: icon, title, two-line summary, date, download column.
function PoliciesLoading() {
  return (
    <View className="gap-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i} padded={false} className="flex-row">
          <View className="flex-1 flex-row items-start gap-4 p-4">
            <Skeleton width={40} height={40} rounded="rounded-lg" />
            <View className="flex-1 gap-1.5">
              <Skeleton height={14} width="55%" />
              <Skeleton height={10} width="95%" rounded="rounded" />
              <Skeleton height={10} width="70%" rounded="rounded" />
              <Skeleton height={10} width={110} rounded="rounded" className="mt-1.5" />
            </View>
          </View>
          <View className="items-center justify-center border-l border-border-default px-3">
            <Skeleton width={20} height={20} rounded="rounded" />
          </View>
        </Card>
      ))}
    </View>
  )
}

export default function LegalIndexScreen() {
  const router = useRouter()
  const { data: policies, isLoading, isError, refetch } = useQuery({ queryKey: ['legal-policies'], queryFn: listPolicies, staleTime: 3_600_000 })

  return (
    <Screen header={<ScreenHeader title="Policies & Legal" />} contentClassName="gap-8" scrollProps={{ showsVerticalScrollIndicator: false }}>
      <BodySmall className="-mb-4">Everything you need to know about how we operate, your rights, and our commitments to you.</BodySmall>

      {isLoading ? (
        <PoliciesLoading />
      ) : isError || !policies ? (
        <ErrorState title="Couldn't load the policies" message="Please try again." onRetry={() => refetch()} />
      ) : (
        <View className="gap-4">
          {policies.map(policy => (
            <Card key={policy.slug} padded={false} className="flex-row">
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/legal/${policy.slug}`)}
                className="min-w-0 flex-1 flex-row items-start gap-4 rounded-l-panel p-4 active:bg-surface-secondary"
              >
                <View className="h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 dark:bg-primary-900/20">
                  <TintedIcon icon={POLICY_ICONS[policy.slug] ?? DEFAULT_POLICY_ICON} size={20} strokeWidth={1.75} className="text-primary-600 dark:text-primary-400" />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[15px] font-bold text-foreground">{policy.title}</Text>
                  <BodySmall numberOfLines={2} className="mt-0.5">
                    {policy.description}
                  </BodySmall>
                  <Caption className="mt-2">Updated {policy.lastUpdated}</Caption>
                </View>
              </Pressable>
              <View className="items-center justify-center border-l border-border-default px-1">
                <IconButton icon={Download} label={`Download ${policy.title} as PDF`} onPress={() => openPolicyPdf(policy.slug)} />
              </View>
            </Card>
          ))}
        </View>
      )}

      <Card>
        <Subheading className="mb-2">Subscriptions &amp; auto-debit</Subheading>
        <View className="gap-1.5">
          {SUBSCRIPTION_TERMS.map(term => (
            <View key={term} className="flex-row pl-1">
              <Text className="w-4 text-sm text-foreground-secondary">•</Text>
              <Text className="flex-1 text-sm text-foreground-secondary">{term}</Text>
            </View>
          ))}
        </View>
        <Caption className="mt-3">
          Full terms:{' '}
          <Text className="font-semibold text-primary-600 dark:text-primary-400" onPress={() => router.push('/legal/terms-and-conditions')}>
            Terms &amp; Conditions
          </Text>{' '}
          ·{' '}
          <Text className="font-semibold text-primary-600 dark:text-primary-400" onPress={() => router.push('/legal/return-refund-policy')}>
            Return &amp; Refund Policy
          </Text>
        </Caption>
      </Card>

      <Card className="items-center">
        <BodySmall className="mb-4 text-center">Can&apos;t find what you&apos;re looking for? Our support team can help.</BodySmall>
        <Button label="Contact Support" size="md" onPress={() => openHref(router, '/support')} />
      </Card>
    </Screen>
  )
}
