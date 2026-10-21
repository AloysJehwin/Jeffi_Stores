import { Tabs } from 'expo-router'
import { View, Text } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useCartStore } from '../../src/stores/cartStore'
import { useTokens } from '../../src/theme'

function CartIcon({ color, size }: { color: string; size: number }) {
  const count = useCartStore((s) => s.count)
  return (
    <View>
      <Ionicons name="cart-outline" size={size} color={color} />
      {count > 0 && (
        <View className="absolute -top-1 -right-1.5 bg-accent-500 rounded-full min-w-[15px] h-[15px] items-center justify-center px-0.5">
          <Text className="text-white text-[9px] font-black leading-none">
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      )}
    </View>
  )
}

export default function TabLayout() {
  const t = useTokens()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent500,
        tabBarInactiveTintColor: t.foregroundMuted,
        tabBarStyle: {
          backgroundColor: t.surfaceElevated,
          borderTopColor: t.border,
          borderTopWidth: 1,
          height: 56,
          paddingBottom: 6,
          paddingTop: 6,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="products"
        options={{
          title: 'All Products',
          tabBarIcon: ({ color, size }) => <Ionicons name="grid-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="cart"
        options={{
          tabBarIcon: ({ color, size }) => <CartIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="wishlist"
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="heart-outline" size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          tabBarIcon: ({ color, size }) => <Ionicons name="person-outline" size={size} color={color} />,
          tabBarStyle: { display: 'none' },
        }}
      />
    </Tabs>
  )
}
