import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Download, FileQuestion } from 'lucide-react-native'
import { BodySmall, Button, Caption, Card, EmptyState, Screen, ScreenHeader, Skeleton, SkeletonText, Subheading, Text } from '../../src/ui'
import { openPolicyPdf } from '../../src/components/info/policy'
import { getPolicy } from '../../src/api/info'
import { openHref } from '../../src/lib/links'

// Mirror of controller-service app/(marketing)/legal/[slug]/page.tsx at the mobile breakpoint.

// Summary strip with the download button, then section cards.
function PolicyLoading() {
  return (
    <View>
      <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
        <View className="flex-row items-start gap-4">
          <View className="flex-1 gap-2">
            <Skeleton height={12} width="95%" className="mt-1" />
            <Skeleton height={10} width={130} rounded="rounded" />
          </View>
          <Skeleton height={36} width={140} rounded="rounded-lg" />
        </View>
      </View>
      <View className="gap-4 px-4 py-8">
        {[0, 1, 2].map(i => (
          <Card key={i}>
            <Skeleton height={16} width="50%" className="mb-4" />
            <SkeletonText lines={4} />
          </Card>
        ))}
      </View>
    </View>
  )
}

export default function PolicyScreen() {
  const router = useRouter()
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const { data: policy, isLoading, isError } = useQuery({
    queryKey: ['legal-policy', slug],
    queryFn: () => getPolicy(slug),
    enabled: !!slug,
    staleTime: 3_600_000,
  })

  const supportCard = (
    <Card className="items-center">
      <Caption className="mb-3 text-center">Have questions about our policies?</Caption>
      <Button label="Contact Support" size="md" onPress={() => openHref(router, '/support')} />
    </Card>
  )

  const header = <ScreenHeader title={policy?.title} />
  if (isLoading) return <Screen header={header} mode="none" loading skeleton={<PolicyLoading />} />
  if (isError || !policy) {
    return (
      <Screen header={header} mode="none">
        <EmptyState fill icon={FileQuestion} title="Policy not found" actionLabel="Legal & Policies" onAction={() => router.dismissTo('/legal')} />
      </Screen>
    )
  }

  return (
    <Screen header={header} padded={false} scrollProps={{ showsVerticalScrollIndicator: false }}>
      {/* Flush under the header, as the title strip was. */}
      <View className="-mt-4 border-b border-border-default bg-surface-elevated px-4 py-4">
        <View className="flex-row items-start gap-4">
          <View className="min-w-0 flex-1">
            <BodySmall>{policy.description}</BodySmall>
            <Caption className="mt-1">Last updated: {policy.lastUpdated}</Caption>
          </View>
          <Button label="Download PDF" icon={Download} size="sm" block={false} onPress={() => openPolicyPdf(policy.slug)} />
        </View>
      </View>

      <View className="gap-4 px-4 py-8">
        {policy.sections.map((section, i) => (
          <Card key={i}>
            <Subheading className="mb-3">{section.heading}</Subheading>
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
          </Card>
        ))}
        {supportCard}
      </View>
    </Screen>
  )
}
