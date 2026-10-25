import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { CreditCard, Tag } from 'lucide-react-native'
import { Overline, Text, useEntering, useMotion } from '../../ui'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { getRazorpayOffers } from '../../api/pdp'
import { openHref } from '../../lib/links'
import { status, useTokens } from '../../theme'

// Mirror of controller-service components/visitor/RazorpayOffers.tsx: the account's live bank offers, auto-rotating.

const AUTO_MS = 3500

// from-X-700 to-X-900: the from colour as the base, darkened toward the right by an overlay.
const GRADIENTS = ['bg-blue-700', 'bg-indigo-700', 'bg-orange-600', 'bg-purple-700', 'bg-rose-700', 'bg-emerald-700']

export default function RazorpayOffers() {
  const router = useRouter()
  const { data: offers = [] } = useQuery({ queryKey: ['pdp-razorpay-offers'], queryFn: getRazorpayOffers, staleTime: 300_000 })
  const [active, setActive] = useState(0)
  const t = useTokens()
  const fadeIn = useEntering(FadeIn.duration(500))
  const fadeOut = useEntering(FadeOut.duration(500))
  const { animate } = useMotion()

  useEffect(() => {
    if (offers.length < 2 || !animate) return
    const t = setTimeout(() => setActive(a => (a + 1) % offers.length), AUTO_MS)
    return () => clearTimeout(t)
  }, [active, offers.length, animate])

  if (offers.length === 0) return null
  const i = active % offers.length
  const offer = offers[i]

  return (
    <View className="mt-4">
      <View className="mb-2 flex-row items-center gap-2">
        <CreditCard size={14} color={t.accent500} />
        <Overline className="text-foreground-secondary">Bank Offers via Razorpay</Overline>
      </View>

      <Pressable
        onPress={() => openHref(router, '/legal/terms-and-conditions#5a-bank-offers-cashback')}
        accessibilityRole="link"
        accessibilityLabel={`${offer.title}. Bank offer terms`}
        accessibilityActions={offers.length > 1 ? [{ name: 'next', label: 'Next offer' }] : undefined}
        onAccessibilityAction={() => setActive(a => (a + 1) % offers.length)}
        className="relative h-11 overflow-hidden rounded-field"
      >
        <Animated.View
          key={offer.id}
          entering={fadeIn}
          exiting={fadeOut}
          className={`absolute inset-0 flex-row items-center gap-3 px-3 ${GRADIENTS[i % GRADIENTS.length]}`}
        >
          <Svg style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} width="100%" height="100%">
            <Defs>
              <LinearGradient id={`rzpOffer${i}`} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={status.black} stopOpacity={0} />
                <Stop offset="1" stopColor={status.black} stopOpacity={0.35} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#rzpOffer${i})`} />
          </Svg>
          <Tag size={14} color={status.white} opacity={0.7} />
          <Text numberOfLines={1} className="flex-1 text-xs text-white/90">
            {offer.title}
          </Text>
        </Animated.View>

        {offers.length > 1 ? (
          <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden className="absolute bottom-1.5 right-2 z-10 flex-row items-center gap-1">
            {offers.map((o, n) => (
              <Pressable
                key={o.id}
                onPress={() => setActive(n)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={`Offer ${n + 1}`}
                className={`rounded-full ${n === i ? 'h-1 w-3 bg-white' : 'h-1 w-1 bg-white/40'}`}
              />
            ))}
          </View>
        ) : null}
      </Pressable>
    </View>
  )
}
