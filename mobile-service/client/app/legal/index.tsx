import { Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopNav from '../../src/components/layout/TopNav'
import { Skeleton } from '../../src/ui'
import { Glyph, DOCUMENT, DOWNLOAD } from '../../src/components/info/Glyph'
import { POLICY_ICONS, openPolicyPdf } from '../../src/components/info/policy'
import { PageHeader, SolidButton } from '../../src/components/info/common'
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
        <View key={i} className="flex-row rounded-xl border border-border-default bg-surface-elevated">
          <View className="flex-1 flex-row items-start gap-4 p-5">
            <Skeleton width={40} height={40} rounded="rounded-lg" />
            <View className="flex-1 gap-1.5">
              <Skeleton height={14} width="55%" />
              <Skeleton height={10} width="95%" rounded="rounded" />
              <Skeleton height={10} width="70%" rounded="rounded" />
              <Skeleton height={10} width={110} rounded="rounded" className="mt-1.5" />
            </View>
          </View>
          <View className="items-center justify-center border-l border-border-default px-3">
            <Skeleton width={16} height={16} rounded="rounded" />
          </View>
        </View>
      ))}
    </View>
  )
}

export default function LegalIndexScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { data: policies, isLoading, isError } = useQuery({ queryKey: ['legal-policies'], queryFn: listPolicies, staleTime: 3_600_000 })

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom }}>
        <PageHeader
          title="Policies & Legal"
          subtitle="Everything you need to know about how we operate, your rights, and our commitments to you."
          subtitleClassName="text-sm text-foreground-secondary"
        />

        <View className="gap-8 px-4 py-8">
          {isLoading ? (
            <PoliciesLoading />
          ) : isError || !policies ? (
            <Text className="text-center text-sm text-foreground-muted">Couldn&apos;t load the policies. Please try again.</Text>
          ) : (
            <View className="gap-4">
              {policies.map(policy => (
                <View key={policy.slug} className="flex-row items-start gap-3 rounded-xl border border-border-default bg-surface-elevated">
                  <Pressable
                    onPress={() => router.push(`/legal/${policy.slug}`)}
                    className="min-w-0 flex-1 flex-row items-start gap-4 p-5"
                  >
                    <View className="h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 dark:bg-primary-900/20">
                      <Glyph
                        d={POLICY_ICONS[policy.slug] ?? DOCUMENT}
                        size={20}
                        strokeWidth={1.5}
                        className="text-primary-600 dark:text-primary-400"
                      />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-bold text-foreground">{policy.title}</Text>
                      <Text numberOfLines={2} className="mt-0.5 text-xs leading-relaxed text-foreground-secondary">
                        {policy.description}
                      </Text>
                      <Text className="mt-2 text-xs text-foreground-muted">Updated {policy.lastUpdated}</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityLabel={`Download ${policy.title} as PDF`}
                    onPress={() => openPolicyPdf(policy.slug)}
                    className="shrink-0 items-center justify-center self-stretch rounded-r-xl border-l border-border-default px-3 active:bg-primary-50 dark:active:bg-primary-900/10"
                  >
                    <Glyph d={DOWNLOAD} size={16} className="text-foreground-muted" />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View className="rounded-xl border border-border-default bg-surface-elevated p-6">
            <Text className="mb-2 text-base font-bold text-foreground">Subscriptions &amp; auto-debit</Text>
            <View className="gap-1.5">
              {SUBSCRIPTION_TERMS.map(term => (
                <View key={term} className="flex-row pl-1">
                  <Text className="w-4 text-sm text-foreground-secondary">•</Text>
                  <Text className="flex-1 text-sm text-foreground-secondary">{term}</Text>
                </View>
              ))}
            </View>
            <Text className="mt-3 text-xs text-foreground-muted">
              Full terms:{' '}
              <Text className="text-primary-600" onPress={() => router.push('/legal/terms-and-conditions')}>
                Terms &amp; Conditions
              </Text>{' '}
              ·{' '}
              <Text className="text-primary-600" onPress={() => router.push('/legal/return-refund-policy')}>
                Return &amp; Refund Policy
              </Text>
            </Text>
          </View>

          <View className="items-center rounded-xl border border-border-default bg-surface-elevated p-6">
            <Text className="mb-3 text-center text-sm text-foreground-secondary">
              Can&apos;t find what you&apos;re looking for? Our support team can help.
            </Text>
            <SolidButton label="Contact Support" onPress={() => openHref(router, '/support')} />
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
