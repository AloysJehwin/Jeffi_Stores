import { useState, useRef } from 'react'
import {
  View, Text, TouchableOpacity, Modal, Animated, Dimensions,
  ScrollView, Switch, TextInput, TouchableWithoutFeedback,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { useQuery } from '@tanstack/react-query'
import { useCartStore } from '../../stores/cartStore'
import { useAuthStore } from '../../stores/authStore'
import { useThemeStore } from '../../stores/themeStore'
import { listCategories } from '../../api/categories'

type IoniconName = React.ComponentProps<typeof Ionicons>['name']

const CATEGORY_ICONS: Record<string, IoniconName> = {
  fasteners:               'attach-outline',
  'power-transmission':    'settings-outline',
  'tools-equipment':       'build-outline',
  'tools-and-equipment':   'build-outline',
  'welding-supplies':      'flame-outline',
  'electrical-cables':     'flash-outline',
  'electrical-and-cables': 'flash-outline',
  'industrial-components': 'cog-outline',
  'material-handling':     'cube-outline',
  abrasives:               'disc-outline',
  'safety-equipment':      'shield-checkmark-outline',
  'lubricants-chemicals':  'water-outline',
  'lubricants-and-chemicals': 'water-outline',
  'hand-tools':            'hammer-outline',
  'power-tools':           'battery-charging-outline',
  'measuring-tools':       'resize-outline',
  'cutting-tools':         'cut-outline',
  'drill-bits':            'aperture-outline',
  nuts:                    'ellipse-outline',
  bolts:                   'git-commit-outline',
  washers:                 'radio-button-off-outline',
  screws:                  'git-commit-outline',
  chains:                  'link-outline',
  bearings:                'radio-button-on-outline',
  valves:                  'funnel-outline',
  default:                 'layers-outline',
}

function getCategoryIcon(slug: string): IoniconName {
  const key = slug.toLowerCase()
  if (CATEGORY_ICONS[key]) return CATEGORY_ICONS[key]
  for (const k of Object.keys(CATEGORY_ICONS)) {
    if (key.includes(k) || k.includes(key)) return CATEGORY_ICONS[k]
  }
  return CATEGORY_ICONS.default
}

const { width: SCREEN_WIDTH } = Dimensions.get('window')
const DRAWER_WIDTH = SCREEN_WIDTH * 0.78

interface TopNavProps {
  onSearchPress?: () => void
}

export default function TopNav({ onSearchPress }: TopNavProps) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const cartCount = useCartStore((s) => s.count)
  const { user } = useAuthStore()
  const { colorScheme, toggle } = useThemeStore()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current

  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: listCategories,
    staleTime: 5 * 60 * 1000,
  })
  const categories = (categoriesData || [])
    .filter((c) => c.parent_category_id === null)
    .sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999))

  const openDrawer = () => {
    setDrawerOpen(true)
    Animated.spring(drawerAnim, {
      toValue: 0,
      useNativeDriver: true,
      bounciness: 0,
      speed: 20,
    }).start()
  }

  const closeDrawer = () => {
    Animated.timing(drawerAnim, {
      toValue: -DRAWER_WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start(() => setDrawerOpen(false))
  }

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setSearchOpen(false)
      setSearchQuery('')
      router.push(`/(tabs)/products?search=${encodeURIComponent(searchQuery.trim())}` as any)
    }
  }

  return (
    <>
      <View style={{ paddingTop: insets.top }} className="bg-white dark:bg-[#24252f] border-b border-gray-200 dark:border-[#3f4150]">
        <View className="flex-row items-center justify-between px-3 h-14">
          <TouchableOpacity onPress={() => router.push('/(tabs)')} className="flex-row items-center gap-2" activeOpacity={0.7}>
            <View className="w-9 h-9 bg-accent-500 rounded-lg items-center justify-center">
              <Text className="text-white font-black text-sm">JS</Text>
            </View>
            <Text className="font-bold text-gray-900 dark:text-gray-100 text-base">Jeffi Stores</Text>
          </TouchableOpacity>

          <View className="flex-row items-center gap-1">
            <TouchableOpacity
              onPress={() => { if (onSearchPress) { onSearchPress() } else { setSearchOpen(true) } }}
              className="w-10 h-10 items-center justify-center"
            >
              <Ionicons name="search-outline" size={22} color="#6B7280" />
            </TouchableOpacity>

            <TouchableOpacity onPress={() => router.push('/(tabs)/cart')} className="w-10 h-10 items-center justify-center">
              <View>
                <Ionicons name="cart-outline" size={22} color="#6B7280" />
                {cartCount > 0 && (
                  <View className="absolute -top-1 -right-1 bg-accent-500 rounded-full min-w-[15px] h-[15px] items-center justify-center px-0.5">
                    <Text className="text-white text-[9px] font-black leading-none">
                      {cartCount > 99 ? '99+' : cartCount}
                    </Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>

            <TouchableOpacity onPress={openDrawer} className="w-10 h-10 items-center justify-center">
              <Ionicons name="menu-outline" size={26} color="#6B7280" />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Search overlay */}
      <Modal visible={searchOpen} transparent animationType="fade" onRequestClose={() => setSearchOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setSearchOpen(false)}>
          <View className="flex-1 bg-black/50">
            <TouchableWithoutFeedback>
              <View style={{ paddingTop: insets.top }} className="bg-white dark:bg-[#24252f] shadow-lg">
                <View className="flex-row items-center px-3 h-14 gap-2">
                  <TouchableOpacity onPress={() => setSearchOpen(false)} className="w-10 h-10 items-center justify-center">
                    <Ionicons name="arrow-back" size={22} color="#6B7280" />
                  </TouchableOpacity>
                  <View className="flex-1 flex-row items-center bg-gray-100 dark:bg-[#2e303b] rounded-xl px-3 h-10 gap-2">
                    <Ionicons name="search-outline" size={18} color="#9CA3AF" />
                    <TextInput
                      autoFocus
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      onSubmitEditing={handleSearch}
                      placeholder="Search products..."
                      placeholderTextColor="#9CA3AF"
                      returnKeyType="search"
                      className="flex-1 text-gray-900 dark:text-gray-100 text-sm"
                    />
                    {searchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <Ionicons name="close-circle" size={18} color="#9CA3AF" />
                      </TouchableOpacity>
                    )}
                  </View>
                  <TouchableOpacity
                    onPress={handleSearch}
                    className="bg-accent-500 px-4 h-10 rounded-xl items-center justify-center"
                  >
                    <Text className="text-white font-semibold text-sm">Search</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Drawer */}
      <Modal visible={drawerOpen} transparent animationType="none" onRequestClose={closeDrawer}>
        <View className="flex-1">
          {/* Backdrop */}
          <TouchableWithoutFeedback onPress={closeDrawer}>
            <View className="absolute inset-0 bg-black/50" />
          </TouchableWithoutFeedback>

          {/* Drawer panel slides in from left */}
          <Animated.View
            style={{
              width: DRAWER_WIDTH,
              transform: [{ translateX: drawerAnim }],
              position: 'absolute',
              left: 0,
              top: 0,
              bottom: 0,
              shadowColor: '#000',
              shadowOffset: { width: 4, height: 0 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
              elevation: 20,
            }}
            className="bg-white dark:bg-[#24252f]"
          >
            <ScrollView showsVerticalScrollIndicator={false} style={{ paddingTop: insets.top }}>
              {/* Drawer header */}
              <View className="flex-row items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-[#3f4150]">
                <View className="flex-row items-center gap-2">
                  <View className="w-8 h-8 bg-accent-500 rounded-lg items-center justify-center">
                    <Text className="text-white font-black text-xs">JS</Text>
                  </View>
                  <Text className="font-bold text-gray-900 dark:text-gray-100">Jeffi Stores</Text>
                </View>
                <TouchableOpacity onPress={closeDrawer} className="w-8 h-8 items-center justify-center">
                  <Ionicons name="close" size={22} color="#6B7280" />
                </TouchableOpacity>
              </View>

              {/* User greeting */}
              {user ? (
                <TouchableOpacity
                  onPress={() => { closeDrawer(); router.push('/(tabs)/account') }}
                  className="flex-row items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-[#3f4150]"
                >
                  <View className="w-10 h-10 rounded-full bg-accent-500 items-center justify-center">
                    <Text className="text-white font-black">
                      {user.firstName?.[0]?.toUpperCase() || user.email[0]?.toUpperCase()}
                    </Text>
                  </View>
                  <View className="flex-1">
                    <Text className="font-semibold text-gray-900 dark:text-gray-100" numberOfLines={1}>
                      {user.firstName} {user.lastName}
                    </Text>
                    <Text className="text-xs text-gray-400" numberOfLines={1}>{user.email}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => { closeDrawer(); router.push('/(auth)/login') }}
                  className="flex-row items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-[#3f4150]"
                >
                  <View className="w-10 h-10 rounded-full bg-gray-100 dark:bg-[#2e303b] items-center justify-center">
                    <Ionicons name="person-outline" size={20} color="#9CA3AF" />
                  </View>
                  <View className="flex-1">
                    <Text className="font-semibold text-gray-900 dark:text-gray-100">Sign In</Text>
                    <Text className="text-xs text-gray-400">Access orders, wishlist & more</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              )}

              {/* Quick links */}
              <View className="px-5 pt-4 pb-2">
                <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Quick Links</Text>
              </View>
              {[
                { icon: 'home-outline', label: 'Home', route: '/(tabs)' },
                { icon: 'grid-outline', label: 'All Products', route: '/(tabs)/products' },
                { icon: 'layers-outline', label: 'Categories', route: '/categories' },
                { icon: 'heart-outline', label: 'Wishlist', route: '/(tabs)/wishlist' },
                { icon: 'bag-outline', label: 'My Orders', route: '/orders' },
              ].map((item) => (
                <TouchableOpacity
                  key={item.label}
                  onPress={() => { closeDrawer(); router.push(item.route as any) }}
                  className="flex-row items-center gap-3 px-5 py-3.5"
                >
                  <Ionicons name={item.icon as any} size={20} color="#7cb900" />
                  <Text className="text-gray-800 dark:text-gray-200 font-medium">{item.label}</Text>
                </TouchableOpacity>
              ))}

              {/* Categories */}
              {categories.length > 0 && (
                <>
                  <View className="px-5 pt-4 pb-2 border-t border-gray-100 dark:border-[#3f4150] mt-2">
                    <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Categories</Text>
                  </View>
                  {categories.slice(0, 10).map((cat) => (
                    <TouchableOpacity
                      key={cat.id}
                      onPress={() => { closeDrawer(); router.push(`/category/${cat.slug}` as any) }}
                      className="flex-row items-center gap-3 px-5 py-3"
                    >
                      <View className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-900/20 items-center justify-center">
                        <Ionicons name={getCategoryIcon(cat.slug)} size={15} color="#f59e0b" />
                      </View>
                      <Text className="text-gray-700 dark:text-gray-300 text-sm">{cat.name}</Text>
                    </TouchableOpacity>
                  ))}
                  {categories.length > 10 && (
                    <TouchableOpacity
                      onPress={() => { closeDrawer(); router.push('/categories' as any) }}
                      className="px-5 py-3"
                    >
                      <Text className="text-accent-600 dark:text-accent-400 text-sm font-semibold">View all categories →</Text>
                    </TouchableOpacity>
                  )}
                </>
              )}

              {/* Support */}
              <View className="px-5 pt-4 pb-2 border-t border-gray-100 dark:border-[#3f4150] mt-2">
                <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Support</Text>
              </View>
              <View className="px-5 py-3 flex-row items-center gap-3">
                <Ionicons name="call-outline" size={20} color="#7cb900" />
                <Text className="text-gray-700 dark:text-gray-300 text-sm">+91 89030 31299</Text>
              </View>
              <View className="px-5 py-3 flex-row items-center gap-3">
                <Ionicons name="mail-outline" size={20} color="#7cb900" />
                <Text className="text-gray-700 dark:text-gray-300 text-sm">support@jeffistores.in</Text>
              </View>

              {/* Dark mode */}
              <View className="border-t border-gray-100 dark:border-[#3f4150] mt-2 mx-5 py-4 flex-row items-center justify-between">
                <View className="flex-row items-center gap-3">
                  <Ionicons name="moon-outline" size={20} color="#7cb900" />
                  <Text className="text-gray-800 dark:text-gray-200 font-medium">Dark Mode</Text>
                </View>
                <Switch
                  value={colorScheme === 'dark'}
                  onValueChange={toggle}
                  trackColor={{ false: '#E5E7EB', true: '#7cb900' }}
                  thumbColor="#ffffff"
                />
              </View>

              <View className="h-8" />
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  )
}
