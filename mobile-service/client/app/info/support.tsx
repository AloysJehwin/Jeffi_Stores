import { Linking, View, useWindowDimensions } from 'react-native'
import { useRouter } from 'expo-router'
import { Mail, MapPin, MessageSquare, Phone } from 'lucide-react-native'
import { BodySmall, Caption, Card, EmptyState, Heading, ListGroup, ListRow, Overline, Screen, ScreenHeader, Text, Title } from '../../src/ui'
import SupportChat from '../../src/components/info/SupportChat'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { useAuthStore } from '../../src/stores/authStore'
import { openHref } from '../../src/lib/links'

// Mirror of controller-service app/(marketing)/support/page.tsx at the mobile breakpoint.

const QUICK_LINKS = [
  { label: 'My Orders', href: '/account/orders' }, // web /orders redirects here
  { label: 'My Account', href: '/account' },
  { label: 'Wishlist', href: '/wishlist' },
  { label: 'Browse Products', href: '/products' },
  { label: 'All Categories', href: '/categories' },
  { label: 'About Us', href: '/about' },
]

const LEGAL_LINKS = [
  { label: 'Privacy Policy', href: '/legal/privacy-policy' },
  { label: 'Terms & Conditions', href: '/legal/terms-and-conditions' },
  { label: 'Return & Refund Policy', href: '/legal/return-refund-policy' },
  { label: 'Shipping Policy', href: '/legal/shipping-policy' },
  { label: 'Cancellation Policy', href: '/legal/cancellation-policy' },
  { label: 'Warranty Policy', href: '/legal/warranty-policy' },
  { label: 'FAQ', href: '/legal/faq' },
  { label: 'Grievance Redressal', href: '/legal/grievance-redressal' },
]

const HOURS = [
  { day: 'Mon – Fri', time: '9 AM – 7 PM', closed: false },
  { day: 'Saturday', time: '9 AM – 6 PM', closed: false },
  { day: 'Sunday', time: 'Closed', closed: true },
]

function LinkCard({ title, links }: { title: string; links: Array<{ label: string; href: string }> }) {
  const router = useRouter()
  return (
    <ListGroup title={title}>
      {links.map(link => (
        <ListRow key={link.href} title={link.label} onPress={() => openHref(router, link.href)} />
      ))}
    </ListGroup>
  )
}

export default function SupportScreen() {
  const router = useRouter()
  const { height } = useWindowDimensions()
  const { identity } = useStoreConfig()
  const { user, isLoading } = useAuthStore()
  const chatHeight = Math.min(680, Math.max(480, Math.round(height * 0.65)))

  return (
    <Screen header={<ScreenHeader title="Help & Support" />} mode="keyboard" scrollProps={{ showsVerticalScrollIndicator: false }}>
      <View className="mb-6">
        <Title>How can we help?</Title>
        <BodySmall className="mt-1.5">Chat with our support bot or reach us directly.</BodySmall>
      </View>

      <View className="mb-8 gap-6">
        <ListGroup title="Contact Us">
          <ListRow icon={Phone} title={identity.phone} subtitle="Phone" chevron={false} onPress={() => Linking.openURL(`tel:${identity.phone}`)} />
          <ListRow icon={Mail} title={identity.email} subtitle="Email" chevron={false} onPress={() => Linking.openURL(`mailto:${identity.email}`)} />
          <ListRow icon={MapPin} title="Address" subtitle="Sanjay Gandhi Chowk, Station Road, Raipur, CG 490092" />
          <View className="px-4 py-3">
            <Caption className="mb-1.5">Business Hours</Caption>
            <View className="gap-1">
              {HOURS.map(h => (
                <View key={h.day} className="flex-row justify-between">
                  <Text className="text-[13px] text-foreground-secondary">{h.day}</Text>
                  <Text className={h.closed ? 'text-[13px] font-medium text-red-600 dark:text-red-400' : 'text-[13px] font-medium text-foreground'}>{h.time}</Text>
                </View>
              ))}
            </View>
          </View>
        </ListGroup>

        <LinkCard title="Quick Links" links={QUICK_LINKS} />
        <LinkCard title="Legal & Policies" links={LEGAL_LINKS} />
      </View>

      <View className="mb-4">
        <Overline className="mb-1 text-accent-600 dark:text-accent-400">Support Chat</Overline>
        <Heading>Chat with us</Heading>
      </View>

      {isLoading ? null : user ? (
        <Card padded={false} className="overflow-hidden" style={{ height: chatHeight }}>
          <SupportChat />
        </Card>
      ) : (
        <Card padded={false}>
          <EmptyState
            icon={MessageSquare}
            title="Sign in to use Support Chat"
            message="Log in to chat with our support bot and get help with your orders and account."
            actionLabel="Sign In"
            onAction={() => openHref(router, '/login')}
          />
        </Card>
      )}
    </Screen>
  )
}
