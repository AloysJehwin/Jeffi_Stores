import { useState } from 'react'
import { Linking, View, useWindowDimensions } from 'react-native'
import { Card, Overline, Screen, ScreenHeader, Text, TextButton, useBottomInset } from '../../src/ui'
import { Image } from 'expo-image'
import { useLocalSearchParams } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { getBrand } from '../../src/api/brands'
import type { BrandProfile } from '../../src/types'
import CompareBar from '../../src/components/catalog/CompareBar'
import PagedProductGrid from '../../src/components/catalog/PagedProductGrid'
import { EmptyCard, ListingPageSkeleton } from '../../src/components/catalog/Paged'
import { SortButton, SortSheet } from '../../src/components/catalog/FilterSheet'
import { productSortKey, type ProductSortId } from '../../src/components/catalog/listing'
import { absUrl } from '../../src/lib/links'
import { useImageSource } from '../../src/hooks/useImageSource'

// Mirror of controller-service app/(storefront)/brands/[slug]/page.tsx at the mobile breakpoint.

const PAGE_SIZE = 25

const SOCIAL: Array<[keyof NonNullable<BrandProfile['social_links']>, string]> = [
  ['instagram', 'Instagram'],
  ['youtube', 'YouTube'],
  ['facebook', 'Facebook'],
  ['linkedin', 'LinkedIn'],
  ['x', 'X'],
]

const paragraphs = (v?: string | null) =>
  (v ?? '')
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean)

const warrantyLabel = (months?: number | null, type?: string | null) => {
  const m = Number(months)
  const t = (type ?? '').replace(/_/g, ' ')
  const span = Number.isFinite(m) && m > 0 ? (m % 12 === 0 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} month${m === 1 ? '' : 's'}`) : ''
  return [span, t].filter(Boolean).join(' ')
}

function Fact({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <View className="min-w-[45%] flex-1">
      <Overline>{label}</Overline>
      {onPress ? (
        <TextButton label={value} onPress={onPress} className="self-start" />
      ) : (
        <Text className="text-sm capitalize text-foreground-secondary">{value}</Text>
      )}
    </View>
  )
}

/** Facts row, story, social links and the warranty & service card; each hides when empty. */
function BrandProfileBlocks({ brand }: { brand: BrandProfile }) {
  const facts: Array<[string, string]> = []
  if (brand.founded_year) facts.push(['Founded', String(brand.founded_year)])
  if (brand.headquarters) facts.push(['Headquarters', brand.headquarters])
  if (brand.country_of_origin) facts.push(['Origin', brand.country_of_origin.toUpperCase()])
  const social = SOCIAL.filter(([k]) => /^https?:\/\//i.test(brand.social_links?.[k] ?? ''))
  const story = paragraphs(brand.story)
  const warranty = warrantyLabel(brand.default_warranty_months, brand.default_warranty_type)
  const terms = paragraphs(brand.warranty_terms)
  const serviceUrl = /^https?:\/\//i.test(brand.service_url ?? '') ? brand.service_url! : null
  const pdf = /^https?:\/\//i.test(brand.catalogue_pdf_url ?? '') ? brand.catalogue_pdf_url! : null
  const hasService = !!(warranty || terms.length || brand.service_phone || brand.service_email || serviceUrl || pdf)
  if (!facts.length && !social.length && !story.length && !hasService) return null
  return (
    <View className="px-4 pt-4">
      {facts.length ? (
        <View className="mb-4 flex-row flex-wrap gap-x-6 gap-y-1">
          {facts.map(([k, v]) => (
            <Text key={k} className="text-sm text-foreground-secondary">
              <Text className="text-sm text-foreground-muted">{k} </Text>
              <Text className="text-sm font-semibold text-foreground">{v}</Text>
            </Text>
          ))}
        </View>
      ) : null}
      {social.length ? (
        <View className="mb-4 flex-row flex-wrap gap-x-4">
          {social.map(([k, label]) => (
            <TextButton key={k} label={label} onPress={() => Linking.openURL(brand.social_links![k]!)} />
          ))}
        </View>
      ) : null}
      {story.length ? (
        <Card className="mb-6 p-5" padded={false}>
          <Text accessibilityRole="header" className="mb-3 font-display text-xl font-extrabold text-foreground">
            About {brand.name}
          </Text>
          {story.map((p, i) => (
            <Text key={i} className={`text-[15px] leading-[22px] text-foreground-secondary${i ? ' mt-3' : ''}`}>
              {p}
            </Text>
          ))}
        </Card>
      ) : null}
      {hasService ? (
        <Card className="mb-6 p-5" padded={false}>
          <Text accessibilityRole="header" className="mb-3 font-display text-xl font-extrabold text-foreground">
            Warranty & service
          </Text>
          <View className="flex-row flex-wrap gap-x-6 gap-y-3">
            {warranty ? <Fact label="Standard warranty" value={warranty} /> : null}
            {brand.service_phone ? (
              <Fact label="Service phone" value={brand.service_phone} onPress={() => Linking.openURL(`tel:${brand.service_phone!.replace(/\s+/g, '')}`)} />
            ) : null}
            {brand.service_email ? (
              <Fact label="Service email" value={brand.service_email} onPress={() => Linking.openURL(`mailto:${brand.service_email}`)} />
            ) : null}
            {serviceUrl ? <Fact label="Support" value="Open support page" onPress={() => Linking.openURL(serviceUrl)} /> : null}
            {pdf ? <Fact label="Catalogue" value="Download PDF" onPress={() => Linking.openURL(pdf)} /> : null}
          </View>
          {terms.map((p, i) => (
            <Text key={i} className="mt-3 text-sm leading-5 text-foreground-secondary">
              {p}
            </Text>
          ))}
        </Card>
      ) : null}
    </View>
  )
}

export default function BrandScreen() {
  const { slug, sort, dir, order } = useLocalSearchParams<{ slug: string; sort?: string; dir?: string; order?: string }>()
  const bottomInset = useBottomInset(0)
  const [sortId, setSortId] = useState<ProductSortId>(() => productSortKey(sort, dir ?? order))
  const [sortOpen, setSortOpen] = useState(false)
  const imgSource = useImageSource()
  const { width } = useWindowDimensions()
  const { data: brand, isLoading } = useQuery({ queryKey: ['brand', slug], queryFn: () => getBrand(slug), staleTime: 5 * 60_000 })
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
  const banner = absUrl(brand.banner_mobile_url) ?? absUrl(brand.banner_desktop_url)
  const accent = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(brand.brand_color ?? '') ? brand.brand_color! : null
  const listHeader = (total: number | null) => (
    <>
      {accent ? <View style={{ height: 4, backgroundColor: accent }} /> : null}
      {logo || brand.tagline || brand.description || brand.website ? (
        <View className="border-b border-border-default bg-surface-elevated px-4 py-4">
          <View className="flex-row items-center gap-4">
            {logo ? (
              <View className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-border-default bg-surface-secondary">
                <Image recyclingKey={logo} source={imgSource(logo, 56)} contentFit="contain" style={{ flex: 1, margin: 4 }} accessibilityLabel={brand.name} />
              </View>
            ) : null}
            <View className="min-w-0 flex-1">
              {brand.tagline ? <Text className="text-base font-semibold text-foreground">{brand.tagline}</Text> : null}
              {brand.description ? <Text className="text-foreground-secondary">{brand.description}</Text> : null}
              {brand.website ? <TextButton label={brand.website} onPress={() => Linking.openURL(brand.website!)} className="mt-1" /> : null}
            </View>
          </View>
        </View>
      ) : null}
      {banner ? (
        <View className="px-4 pt-4">
          <Image
            recyclingKey={banner}
            source={imgSource(banner, width)}
            contentFit="cover"
            style={{ width: '100%', aspectRatio: 2, borderRadius: 12 }}
            accessibilityLabel={brand.name}
          />
        </View>
      ) : null}
      <BrandProfileBlocks brand={brand} />

      <View className="px-4 pt-4">
        <View className="mb-6 flex-row items-center justify-between">
          <Text accessibilityRole="header" className="font-display text-xl font-extrabold text-foreground">
            Products ({total ?? 0})
          </Text>
          {(total ?? 0) > 1 || sortId !== 'featured' ? <SortButton value={sortId} onPress={() => setSortOpen(true)} /> : null}
        </View>
      </View>
    </>
  )

  return (
    <Screen header={header} mode="none">
      <PagedProductGrid
        page="brand"
        base={{ brand: brand.id }}
        sort={sortId}
        pageSize={PAGE_SIZE}
        cols={1}
        gap={16}
        header={listHeader}
        bottomInset={bottomInset}
        empty={<EmptyCard title="No Products Yet" body="We're working on adding products for this brand. Check back soon!" />}
      />
      <CompareBar />
      <SortSheet open={sortOpen} onClose={() => setSortOpen(false)} value={sortId} onApply={setSortId} />
    </Screen>
  )
}
