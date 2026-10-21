import { Pressable, ScrollView, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopNav from '../../src/components/layout/TopNav'
import CategoryOffer from '../../src/components/info/CategoryOffer'
import { Glyph, CHEVRON_RIGHT } from '../../src/components/info/Glyph'
import { PageHeader, PrimaryGradient, SHADOW_SM } from '../../src/components/info/common'
import { getAboutCategories } from '../../src/api/info'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { openHref } from '../../src/lib/links'

// Mirror of controller-service app/(marketing)/about/page.tsx at the mobile breakpoint.

const FEATURES = [
  {
    title: 'Quality Products',
    body: 'We stock only genuine, high-quality products from trusted brands like TVS, UNBRAKO, Taparia, and more.',
    box: 'bg-primary-100',
    icon: 'text-primary-600',
    d: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    title: '24/7 Support',
    body: 'Get round-the-clock assistance with our 24/7 support--always here when you need us!',
    box: 'bg-accent-100',
    icon: 'text-accent-600',
    d: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
  },
  {
    title: 'Wide Range',
    body: 'From bolts and nuts to power tools and belts, we have everything you need in one place.',
    box: 'bg-green-100',
    icon: 'text-green-600',
    d: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  },
  {
    title: 'Expert Team',
    body: 'Our knowledgeable staff is ready to help you find exactly what you need.',
    box: 'bg-purple-100',
    icon: 'text-purple-600',
    d: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  },
]

export default function AboutScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { identity } = useStoreConfig()
  const { data: categories = [] } = useQuery({ queryKey: ['about-categories'], queryFn: getAboutCategories, staleTime: 120_000 })

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom }}>
        <PageHeader title={`About ${identity.name}`} subtitle="Your trusted partner for quality products and services" />

        <View className="px-4 py-12">
          <View className="mb-8 overflow-hidden rounded-lg border border-border-default bg-surface-elevated" style={{ boxShadow: SHADOW_SM }}>
            <View className="gap-8 p-4">
              <View>
                <Text className="mb-6 text-2xl font-bold text-foreground">Who We Are</Text>
                <Text className="mb-5 text-base leading-relaxed text-foreground-secondary">
                  {identity.name} is your trusted partner, offering a wide selection of quality products. We guarantee high
                  availability of quality components for all your needs.
                </Text>
                <Text className="mb-5 text-base leading-relaxed text-foreground-secondary">
                  With years of experience, we&apos;ve built a reputation for reliability, quality, and exceptional customer
                  service. Our mission is to keep your operations running smoothly with the right tools and products.
                </Text>
                <Text className="mb-4 text-base leading-relaxed text-foreground-secondary">
                  We ensure high availability of quality products and components. Count on us for reliable products and
                  expert service to keep your operations seamless!
                </Text>
              </View>

              <View>
                <Text className="mb-6 text-2xl font-bold text-foreground">Why Choose Us</Text>
                <View className="gap-6">
                  {FEATURES.map(f => (
                    <View key={f.title} className="flex-row items-start gap-4">
                      <View className={`h-12 w-12 shrink-0 items-center justify-center rounded-lg ${f.box}`}>
                        <Glyph d={f.d} size={24} className={f.icon} />
                      </View>
                      <View className="flex-1">
                        <Text className="mb-1 text-base font-semibold text-foreground">{f.title}</Text>
                        <Text className="text-sm text-foreground-secondary">{f.body}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            </View>
          </View>

          <View className="mb-8 rounded-lg border border-border-default bg-surface-elevated p-4" style={{ boxShadow: SHADOW_SM }}>
            <View className="mb-2 flex-row flex-wrap items-center gap-3">
              <Text className="text-2xl font-bold text-foreground">What We Offer</Text>
              <View className="rounded-full bg-accent-100 px-2.5 py-1 dark:bg-accent-900/30">
                <Text className="text-xs font-semibold text-accent-700 dark:text-accent-400">{categories.length} Categories</Text>
              </View>
            </View>
            <Text className="mb-6 text-sm text-foreground-secondary">Premium products from the brands you trust</Text>
            <CategoryOffer categories={categories} />
            <View className="mt-8 items-center">
              <Pressable
                onPress={() => router.push('/categories')}
                className="flex-row items-center gap-2 rounded-lg bg-accent-500 px-8 py-3 active:bg-accent-600"
              >
                <Text className="text-base font-semibold text-white">View All Categories</Text>
                <Glyph d={CHEVRON_RIGHT} size={16} className="text-white" />
              </Pressable>
            </View>
          </View>

          <View className="items-center overflow-hidden rounded-lg p-4" style={{ boxShadow: SHADOW_SM }}>
            <PrimaryGradient />
            <Text className="mb-4 text-center text-3xl font-bold text-white">Ready to Get Started?</Text>
            <Text className="mb-6 text-center text-lg text-primary-50">Contact us today for all your product and service needs.</Text>
            <View className="w-full gap-4">
              <Pressable onPress={() => openHref(router, '/contact')} className="items-center rounded-lg bg-accent-500 px-8 py-3 active:bg-accent-600">
                <Text className="text-base font-semibold text-white">Contact Us</Text>
              </Pressable>
              <Pressable
                onPress={() => openHref(router, '/products')}
                className="items-center rounded-lg bg-surface-elevated px-8 py-3 active:bg-surface-secondary"
              >
                <Text className="text-base font-semibold text-primary-700">Browse Products</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
