import { Linking, Pressable, Text, View } from 'react-native'
import { Image } from 'expo-image'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { listBrands, type BrandDetail } from '../../src/api/brands'
import TopNav from '../../src/components/layout/TopNav'
import CompareBar from '../../src/components/catalog/CompareBar'
import PagedProductGrid from '../../src/components/catalog/PagedProductGrid'
import { Breadcrumb, EmptyCard, ListingPageSkeleton } from '../../src/components/catalog/Paged'
import { absUrl } from '../../src/lib/links'

// Mirror of controller-service app/(storefront)/brands/[slug]/page.tsx at the mobile breakpoint.

const PAGE_SIZE = 25

export default function BrandScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { data, isLoading } = useQuery({ queryKey: ['brands'], queryFn: listBrands, staleTime: 5 * 60_000 })
  const brand = (data ?? []).find(b => b.slug === slug) as BrandDetail | undefined

  if (isLoading) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <ListingPageSkeleton logo cols={1} gap={16} />
      </View>
    )
  }

  if (!brand) {
    return (
      <View className="flex-1 bg-surface">
        <TopNav />
        <View className="p-4">
          <EmptyCard title="Brand not found" body="This brand doesn't exist or is no longer available." />
        </View>
      </View>
    )
  }

  const logo = absUrl(brand.logo_url)
  const header = (total: number | null) => (
    <>
      <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
        <View className="mb-4">
          <Breadcrumb
            items={[
              { label: 'Home', onPress: () => router.navigate('/(tabs)') },
              { label: 'Brands', onPress: () => router.push('/brands') },
              { label: brand.name },
            ]}
          />
        </View>
        <View className="flex-row items-center gap-4">
          {logo ? (
            <View className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border-default bg-surface-secondary">
              <Image source={{ uri: logo }} contentFit="contain" style={{ flex: 1, margin: 4 }} accessibilityLabel={brand.name} />
            </View>
          ) : null}
          <View className="min-w-0 flex-1">
            <Text className="mb-2 text-3xl font-bold text-secondary-500 dark:text-foreground">{brand.name}</Text>
            {brand.description ? <Text className="text-foreground-secondary">{brand.description}</Text> : null}
            {brand.website ? (
              <Pressable onPress={() => Linking.openURL(brand.website!)} className="mt-1 self-start">
                <Text className="text-sm text-accent-500">{brand.website}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>

      <View className="px-4 pt-4">
        <View className="mb-6 flex-row items-center justify-between">
          <Text className="text-xl font-bold text-foreground">Products ({total ?? 0})</Text>
        </View>
      </View>
    </>
  )

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <PagedProductGrid
        base={{ brand: brand.id }}
        pageSize={PAGE_SIZE}
        cols={1}
        gap={16}
        header={header}
        bottomInset={insets.bottom}
        empty={<EmptyCard title="No Products Yet" body="We're working on adding products for this brand. Check back soon!" />}
      />
      <CompareBar />
    </View>
  )
}
