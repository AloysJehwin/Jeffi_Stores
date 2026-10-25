import { Tabs } from 'expo-router'
import { useTokens } from '../../src/theme'

// No bottom bar: the top bar carries search, the cart and the menu. The tab navigator stays so
// these screens keep their routes and state.
export default function TabLayout() {
  const t = useTokens()
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarStyle: { display: 'none' }, sceneStyle: { backgroundColor: t.surface } }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="products" options={{ title: 'All Products' }} />
      <Tabs.Screen name="cart" options={{ title: 'Cart' }} />
      <Tabs.Screen name="wishlist" options={{ title: 'Wishlist' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  )
}
