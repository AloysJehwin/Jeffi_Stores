import { useEffect, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { Glyph, P } from './Glyph'
import { getRazorpayOffers } from '../../api/pdp'
import { openHref } from '../../lib/links'
import { status } from '../../theme'

// Mirror of controller-service components/visitor/RazorpayOffers.tsx: the account's live bank offers, auto-rotating.

const AUTO_MS = 3500

// from-X-700 to-X-900: the from colour as the base, darkened toward the right by an overlay.
const GRADIENTS = ['bg-blue-700', 'bg-indigo-700', 'bg-orange-600', 'bg-purple-700', 'bg-rose-700', 'bg-emerald-700']

export default function RazorpayOffers() {
  const router = useRouter()
  const { data: offers = [] } = useQuery({ queryKey: ['pdp-razorpay-offers'], queryFn: getRazorpayOffers, staleTime: 300_000 })
  const [active, setActive] = useState(0)

  useEffect(() => {
    if (offers.length < 2) return
    const t = setTimeout(() => setActive(a => (a + 1) % offers.length), AUTO_MS)
    return () => clearTimeout(t)
  }, [active, offers.length])

  if (offers.length === 0) return null
  const i = active % offers.length
  const offer = offers[i]

  return (
    <View className="mt-4">
      <View className="mb-2 flex-row items-center gap-2">
        <Glyph d={P.card} size={14} className="text-accent-500" />
        <Text className="text-[10px] font-semibold uppercase text-foreground-secondary" style={{ letterSpacing: 0.25 }}>
          Bank Offers via Razorpay
        </Text>
      </View>

      <Pressable
        onPress={() => openHref(router, '/legal/terms-and-conditions#5a-bank-offers-cashback')}
        accessibilityLabel="Bank offer T&C"
        className="relative h-10 overflow-hidden rounded-lg"
      >
        <Animated.View
          key={offer.id}
          entering={FadeIn.duration(500)}
          exiting={FadeOut.duration(500)}
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
          <Glyph d={P.tag} size={14} className="text-white/70" />
          <Text numberOfLines={1} className="flex-1 text-[11px] text-white/90">
            {offer.title}
          </Text>
        </Animated.View>

        {offers.length > 1 ? (
          <View className="absolute bottom-1.5 right-2 z-10 flex-row items-center gap-1">
            {offers.map((o, n) => (
              <Pressable
                key={o.id}
                onPress={() => setActive(n)}
                hitSlop={4}
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
