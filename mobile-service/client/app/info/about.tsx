import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, CircleCheck, Clock, Box, Users } from 'lucide-react-native'
import { Badge, Body, BodySmall, Button, Card, Heading, Screen, ScreenHeader, Subheading, Text, TintedIcon, Title } from '../../src/ui'
import Gradient from '../../src/components/account/Gradient'
import CategoryOffer from '../../src/components/info/CategoryOffer'
import { getAboutCategories } from '../../src/api/info'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { openHref } from '../../src/lib/links'
import { primary, status } from '../../src/theme'

// Mirror of controller-service app/(marketing)/about/page.tsx at the mobile breakpoint.

const FEATURES = [
  {
    title: 'Quality Products',
    body: 'We stock only genuine, high-quality products from trusted brands like TVS, UNBRAKO, Taparia, and more.',
    box: 'bg-primary-100 dark:bg-primary-900/30',
    tint: 'text-primary-600 dark:text-primary-400',
    icon: CircleCheck,
  },
  {
    title: '24/7 Support',
    body: 'Get round-the-clock assistance with our 24/7 support--always here when you need us!',
    box: 'bg-accent-100 dark:bg-accent-900/30',
    tint: 'text-accent-600 dark:text-accent-400',
    icon: Clock,
  },
  {
    title: 'Wide Range',
    body: 'From bolts and nuts to power tools and belts, we have everything you need in one place.',
    box: 'bg-green-100 dark:bg-green-900/30',
    tint: 'text-green-600 dark:text-green-400',
    icon: Box,
  },
  {
    title: 'Expert Team',
    body: 'Our knowledgeable staff is ready to help you find exactly what you need.',
    box: 'bg-purple-100 dark:bg-purple-900/30',
    tint: 'text-purple-600 dark:text-purple-400',
    icon: Users,
  },
]

export default function AboutScreen() {
  const router = useRouter()
  const { identity } = useStoreConfig()
  const { data: categories = [] } = useQuery({ queryKey: ['about-categories'], queryFn: getAboutCategories, staleTime: 120_000 })

  return (
    <Screen
      header={<ScreenHeader title={`About ${identity.name}`} subtitle="Your trusted partner for quality products and services" />}
      scrollProps={{ showsVerticalScrollIndicator: false }}
    >
      <Card className="mb-8 gap-8">
        <View>
          <Heading className="mb-4">Who We Are</Heading>
          <Body className="mb-4 text-foreground-secondary">
            {identity.name} is your trusted partner, offering a wide selection of quality products. We guarantee high
            availability of quality components for all your needs.
          </Body>
          <Body className="mb-4 text-foreground-secondary">
            With years of experience, we&apos;ve built a reputation for reliability, quality, and exceptional customer
            service. Our mission is to keep your operations running smoothly with the right tools and products.
          </Body>
          <Body className="text-foreground-secondary">
            We ensure high availability of quality products and components. Count on us for reliable products and
            expert service to keep your operations seamless!
          </Body>
        </View>

        <View>
          <Heading className="mb-4">Why Choose Us</Heading>
          <View className="gap-6">
            {FEATURES.map(f => (
              <View key={f.title} className="flex-row items-start gap-4">
                <View className={`h-12 w-12 shrink-0 items-center justify-center rounded-xl ${f.box}`}>
                  <TintedIcon icon={f.icon} size={24} className={f.tint} />
                </View>
                <View className="flex-1">
                  <Subheading className="mb-0.5">{f.title}</Subheading>
                  <BodySmall>{f.body}</BodySmall>
                </View>
              </View>
            ))}
          </View>
        </View>
      </Card>

      <Card className="mb-8">
        <View className="mb-2 flex-row flex-wrap items-center gap-3">
          <Heading>What We Offer</Heading>
          <Badge tone="accent" label={`${categories.length} Categories`} />
        </View>
        <BodySmall className="mb-6">Premium products from the brands you trust</BodySmall>
        <CategoryOffer categories={categories} />
        <Button
          className="mt-8"
          label="View All Categories"
          trailing={<ChevronRight size={20} color={status.white} strokeWidth={2.2} />}
          onPress={() => router.push('/categories')}
        />
      </Card>

      <Card className="items-center overflow-hidden">
        <Gradient from={primary[600]} to={primary[800]} />
        <Title className="mb-3 text-center text-white">Ready to Get Started?</Title>
        <Text className="mb-6 text-center text-base text-white/85">Contact us today for all your product and service needs.</Text>
        <View className="w-full gap-3">
          <Button label="Contact Us" onPress={() => openHref(router, '/contact')} />
          <Button label="Browse Products" variant="secondary" onPress={() => openHref(router, '/products')} />
        </View>
      </Card>
    </Screen>
  )
}
