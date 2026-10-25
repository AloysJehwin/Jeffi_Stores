import { Linking, View } from 'react-native'
import { Screen, ScreenHeader, Text, TextButton, useBottomInset } from '../../src/ui'
import { Image } from 'expo-image'
import { useLocalSearchParams } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { listBrands, type BrandDetail } from '../../src/api/brands'
import CompareBar from '../../src/components/catalog/CompareBar'
import PagedProductGrid from '../../src/components/catalog/PagedProductGrid'
import { EmptyCard, ListingPageSkeleton } from '../../src/components/catalog/Paged'
import { absUrl } from '../../src/lib/links'

// Mirror of controller-service app/(storefront)/brands/[slug]/page.tsx at the mobile breakpoint.

const PAGE_SIZE = 25

export default function BrandScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>()
  const bottomInset = useBottomInset(0)
  const { data, isLoading } = useQuery({ queryKey: ['brands'], queryFn: listBrands, staleTime: 5 * 60_000 })
  const brand = (data ?? []).find(b => b.slug === slug) as BrandDetail | undefined
  const header = <ScreenHeader title={brand?.name} />

  if (isLoading) return <Screen header={header} mode="none" loading skeleton={<ListingPageSkeleton logo cols={1} gap={16} />} />

  if (!brand) {
    return (
      <Screen header={header} mode="none">
        <View className="p-4">
          <EmptyCard title="Brand not found" body="This brand doesn't exist or is no longer available." />
        </View>
      </Screen>
    )
  }

  const logo = absUrl(brand.logo_url)
  const listHeader = (total: number | null) => (
    <>
      {logo || brand.description || brand.website ? (
        <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
          <View className="flex-row items-center gap-4">
            {logo ? (
              <View className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface-secondary">
                <Image recyclingKey={logo} source={{ uri: logo }} contentFit="contain" style={{ flex: 1, margin: 4 }} accessibilityLabel={brand.name} />
              </View>
            ) : null}
            <View className="min-w-0 flex-1">
              {brand.description ? <Text className="text-foreground-secondary">{brand.description}</Text> : null}
              {brand.website ? <TextButton label={brand.website} onPress={() => Linking.openURL(brand.website!)} className="mt-1" /> : null}
            </View>
          </View>
        </View>
      ) : null}

      <View className="px-4 pt-4">
        <View className="mb-6 flex-row items-center justify-between">
          <Text accessibilityRole="header" className="font-display text-xl font-extrabold text-foreground">
            Products ({total ?? 0})
          </Text>
        </View>
      </View>
    </>
  )

  return (
    <Screen header={header} mode="none">
      <PagedProductGrid
        base={{ brand: brand.id }}
        pageSize={PAGE_SIZE}
        cols={1}
        gap={16}
        header={listHeader}
        bottomInset={bottomInset}
        empty={<EmptyCard title="No Products Yet" body="We're working on adding products for this brand. Check back soon!" />}
      />
      <CompareBar />
    </Screen>
  )
}
