import { Linking, Pressable, Text, View, useWindowDimensions } from 'react-native'
import { KeyboardScroll } from '../../src/ui/KeyboardScroll'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import TopNav from '../../src/components/layout/TopNav'
import SupportChat from '../../src/components/info/SupportChat'
import { Glyph, CHAT, CHEVRON_RIGHT } from '../../src/components/info/Glyph'
import { SHADOW_SM, SolidButton } from '../../src/components/info/common'
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
    <View className="rounded-xl border border-border-default bg-surface-elevated p-5">
      <Text className="mb-3 text-sm font-bold text-foreground">{title}</Text>
      <View>
        {links.map((link, i) => (
          <Pressable
            key={link.href}
            onPress={() => openHref(router, link.href)}
            className={`flex-row items-center justify-between py-2 ${i > 0 ? 'border-t border-border-default' : ''}`}
          >
            <Text className="text-sm text-foreground-secondary">{link.label}</Text>
            <Glyph d={CHEVRON_RIGHT} size={14} className="text-foreground-muted" />
          </Pressable>
        ))}
      </View>
    </View>
  )
}

export default function SupportScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { identity } = useStoreConfig()
  const { user, isLoading } = useAuthStore()
  const chatHeight = Math.min(680, Math.max(480, Math.round(height * 0.65)))

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <KeyboardScroll
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom }}
      >
        <View className="px-4 py-8">
          <View className="mb-6">
            <Text className="mb-1 text-xs font-bold uppercase text-accent-500" style={{ letterSpacing: 1.2 }}>
              Help &amp; Support
            </Text>
            <Text className="text-3xl font-extrabold text-foreground">How can we help?</Text>
            <Text className="mt-1.5 text-sm text-foreground-secondary">Chat with our support bot or reach us directly.</Text>
          </View>

          <View className="mb-8 gap-4">
            <View className="gap-4 rounded-xl border border-border-default bg-surface-elevated p-5">
              <Text className="text-sm font-bold text-foreground">Contact Us</Text>
              <View>
                <Text className="mb-1 text-xs text-foreground-muted">Phone</Text>
                <Text className="text-sm font-medium text-foreground" onPress={() => Linking.openURL(`tel:${identity.phone}`)}>
                  {identity.phone}
                </Text>
              </View>
              <View>
                <Text className="mb-1 text-xs text-foreground-muted">Email</Text>
                <Text className="text-sm font-medium text-foreground" onPress={() => Linking.openURL(`mailto:${identity.email}`)}>
                  {identity.email}
                </Text>
              </View>
              <View>
                <Text className="mb-1 text-xs text-foreground-muted">Address</Text>
                <Text className="text-sm font-medium leading-snug text-foreground">
                  Sanjay Gandhi Chowk, Station Road, Raipur, CG 490092
                </Text>
              </View>
              <View className="border-t border-border-default pt-1">
                <Text className="mb-1.5 text-xs text-foreground-muted">Business Hours</Text>
                <View className="gap-1">
                  {HOURS.map(h => (
                    <View key={h.day} className="flex-row justify-between">
                      <Text className="text-xs text-foreground-secondary">{h.day}</Text>
                      <Text className={h.closed ? 'text-xs font-medium text-red-500' : 'text-xs font-medium text-foreground'}>{h.time}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>

            <LinkCard title="Quick Links" links={QUICK_LINKS} />
            <LinkCard title="Legal & Policies" links={LEGAL_LINKS} />
          </View>

          <View className="mb-2">
            <Text className="mb-1 text-xs font-bold uppercase text-accent-500" style={{ letterSpacing: 1.2 }}>
              Support Chat
            </Text>
            <Text className="mb-4 text-xl font-extrabold text-foreground">Chat with us</Text>
          </View>

          {isLoading ? null : user ? (
            <View className="overflow-hidden rounded-2xl border border-border-default" style={{ height: chatHeight, boxShadow: SHADOW_SM }}>
              <SupportChat />
            </View>
          ) : (
            <View className="items-center rounded-2xl border border-border-default bg-surface-elevated py-16" style={{ boxShadow: SHADOW_SM }}>
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
                <Glyph d={CHAT} size={32} className="text-primary-500" />
              </View>
              <Text className="mb-2 text-lg font-bold text-foreground">Sign in to use Support Chat</Text>
              <Text className="mb-6 text-center text-sm text-foreground-secondary">
                Log in to chat with our support bot and get help with your orders and account.
              </Text>
              <SolidButton
                label="Sign In"
                onPress={() => openHref(router, '/login')}
                className="bg-primary-500 px-8 py-2.5 active:bg-primary-600"
              />
            </View>
          )}
        </View>
      </KeyboardScroll>
    </View>
  )
}
