import { Pressable, ScrollView, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopNav from '../../src/components/layout/TopNav'
import { Text, Skeleton, SkeletonText } from '../../src/ui'
import { Glyph, CHEVRON_LEFT, DOWNLOAD } from '../../src/components/info/Glyph'
import { SolidButton } from '../../src/components/info/common'
import { openPolicyPdf } from '../../src/components/info/policy'
import { getPolicy } from '../../src/api/info'
import { openHref } from '../../src/lib/links'

// Mirror of controller-service app/(marketing)/legal/[slug]/page.tsx at the mobile breakpoint.

// Title strip with the download button, then section cards.
function PolicyLoading() {
  return (
    <View>
      <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
        <Skeleton height={12} width={110} rounded="rounded" className="mb-3" />
        <View className="flex-row items-start gap-4">
          <View className="flex-1 gap-2">
            <Skeleton height={28} width="90%" />
            <Skeleton height={28} width="55%" />
            <Skeleton height={12} width="95%" className="mt-1" />
            <Skeleton height={10} width={130} rounded="rounded" />
          </View>
          <Skeleton height={36} width={140} rounded="rounded-lg" />
        </View>
      </View>
      <View className="gap-4 px-4 py-8">
        {[0, 1, 2].map(i => (
          <View key={i} className="rounded-xl border border-border-default bg-surface-elevated p-6">
            <Skeleton height={16} width="50%" className="mb-4" />
            <SkeletonText lines={4} />
          </View>
        ))}
      </View>
    </View>
  )
}

export default function PolicyScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const { data: policy, isLoading, isError } = useQuery({
    queryKey: ['legal-policy', slug],
    queryFn: () => getPolicy(slug),
    enabled: !!slug,
    staleTime: 3_600_000,
  })

  const supportCard = (
    <View className="items-center rounded-xl border border-border-default bg-surface-elevated p-6">
      <Text className="mb-3 text-center text-xs text-foreground-muted">Have questions about our policies?</Text>
      <SolidButton label="Contact Support" onPress={() => openHref(router, '/support')} />
    </View>
  )

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      {isLoading ? (
        <PolicyLoading />
      ) : isError || !policy ? (
        <View className="flex-1 items-center justify-center gap-4 px-8">
          <Text className="text-center text-lg font-bold text-foreground">Policy not found</Text>
          <SolidButton label="Legal & Policies" onPress={() => router.dismissTo('/legal')} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom }}>
          <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
            <Pressable onPress={() => router.dismissTo('/legal')} className="mb-3 flex-row items-center gap-1 self-start">
              <Glyph d={CHEVRON_LEFT} size={12} className="text-accent-500" />
              <Text className="text-xs font-semibold text-accent-500">Legal &amp; Policies</Text>
            </Pressable>
            <View className="flex-row items-start gap-4">
              <View className="min-w-0 flex-1">
                <Text className="mb-2 text-3xl font-bold text-secondary-500 dark:text-foreground">{policy.title}</Text>
                <Text className="text-sm text-foreground-secondary">{policy.description}</Text>
                <Text className="mt-1 text-xs text-foreground-muted">Last updated: {policy.lastUpdated}</Text>
              </View>
              <Pressable
                onPress={() => openPolicyPdf(policy.slug)}
                className="shrink-0 flex-row items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 active:bg-primary-600"
              >
                <Glyph d={DOWNLOAD} size={16} className="text-white" />
                <Text className="text-sm font-semibold text-white">Download PDF</Text>
              </Pressable>
            </View>
          </View>

          <View className="gap-4 px-4 py-8">
            {policy.sections.map((section, i) => (
              <View key={i} className="rounded-xl border border-border-default bg-surface-elevated p-6">
                <Text className="mb-3 text-base font-bold text-foreground">{section.heading}</Text>
                {Array.isArray(section.body) ? (
                  <View className="gap-2">
                    {section.body.map((item, j) => (
                      <View key={j} className="flex-row gap-2">
                        <View className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                        <Text className="flex-1 text-sm leading-relaxed text-foreground-secondary">{item}</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text className="text-sm leading-relaxed text-foreground-secondary">{section.body}</Text>
                )}
              </View>
            ))}
            {supportCard}
          </View>
        </ScrollView>
      )}
    </View>
  )
}
