import { Pressable, View } from 'react-native'
import { cn, elevationClass, Text, useElevation } from '../../ui'
import { Image } from 'expo-image'
import { usePathname, useRouter } from 'expo-router'
import HeroIcon from './HeroIcon'
import { isNavActive, useAccountNavItems, useAccountUser, type AccountNavItem } from './hooks'
import { accent, useTokens } from '../../theme'

// Mirror of controller-service components/visitor/AccountMobileHeader.tsx (lg:hidden parts).

/** The icon-only tab row (`flex-1 py-3.5 border-b-2`, icons w-5). */
function AccountTabRow({ items }: { items: AccountNavItem[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const t = useTokens()
  const shadow = useElevation('overlay')
  return (
    <View className={cn('overflow-hidden rounded-xl bg-surface-elevated', elevationClass('overlay'))} style={shadow}>
      <View className="flex-row">
        {items.map(item => {
          const active = isNavActive(item, pathname)
          return (
            <Pressable
              key={item.href}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: active }}
              onPress={() => !active && router.navigate(item.route as never)}
              className={`flex-1 items-center justify-center py-3.5 border-b-2 ${active ? 'border-accent-500' : 'border-transparent'}`}
            >
              <HeroIcon name={item.icon} size={20} color={active ? accent[500] : t.foregroundMuted} />
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** The green account header + the overlapping icon tab bar (scrolls with the page; TopNav stays above). */
export default function AccountMobileHeader() {
  const router = useRouter()
  const user = useAccountUser()
  const items = useAccountNavItems()

  if (!user) return null

  const initials = `${user.firstName?.[0] || ''}${user.lastName?.[0] || ''}`.toUpperCase() || 'U'

  return (
    <>
      <View className="bg-accent-500 pt-8 pb-16 px-4">
        <Text className="text-lg font-semibold text-white/80 mb-4">My Account</Text>
        <View className="flex-row items-center gap-4">
          <Pressable onPress={() => router.navigate('/(tabs)/account')} accessibilityRole="button" accessibilityLabel="My account" className="w-16 h-16 rounded-full overflow-hidden">
            {user.avatarUrl ? (
              <Image source={{ uri: user.avatarUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
            ) : (
              <View className="w-full h-full bg-white/20 items-center justify-center">
                <Text className="text-2xl font-bold text-white">{initials}</Text>
              </View>
            )}
          </Pressable>
          <View className="flex-1">
            <Text className="text-xl font-bold text-white" numberOfLines={1}>
              {user.firstName} {user.lastName}
            </Text>
            <Text className="text-sm text-white/70 mt-0.5" numberOfLines={1}>
              {user.email}
            </Text>
          </View>
        </View>
      </View>
      <View className="z-10 mx-4 -mt-8 mb-4">
        <AccountTabRow items={items} />
      </View>
    </>
  )
}
