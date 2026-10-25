import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Animated, Easing, Modal, Pressable, ScrollView, Text, TextInput,
  TouchableOpacity, View, useWindowDimensions,
} from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardEvents } from 'react-native-keyboard-controller'
import { usePathname, useRouter } from 'expo-router'
import { useColorScheme } from 'nativewind'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleX, Clock, ImageIcon, Layers, Menu, Moon, Search, ShoppingCart, Sun, User, X } from 'lucide-react-native'
import { api } from '../../api/client'
import { logout } from '../../api/auth'
import { getWishlist } from '../../api/wishlist'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useCartStore } from '../../stores/cartStore'
import { useAuthStore } from '../../stores/authStore'
import { useThemeStore } from '../../stores/themeStore'
import { openHref } from '../../lib/links'
import { inr } from '../../lib/format'
import { accent, useTokens } from '../../theme'
import { Skeleton } from '../../ui'

// Mirror of controller-service visitor/Header.tsx + MobileDrawer.tsx + SearchBar.tsx at the mobile breakpoint.

interface SearchProduct {
  id: string
  name: string
  slug: string
  base_price: number | string
  price_ex_gst: number | string | null
  has_variants: boolean
  variant_min_price: number | string | null
  product_images: Array<{ image_url: string; thumbnail_url: string; is_primary: boolean }> | null
}
interface SearchCategory { id: string; name: string; slug: string }
interface SearchResult { products: SearchProduct[]; categories: SearchCategory[] }

const SHADOW_SM = '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
const SHADOW_LG = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)'
const SHADOW_XL = '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/products', label: 'Products' },
  { href: '/categories', label: 'Categories' },
  { href: '/about', label: 'About Us' },
  { href: '/support', label: 'Support' },
]

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

/** `<img className="h-N w-auto">` — the store logo, round, initials when there is none. */
function StoreLogo({ uri, name, size }: { uri: string | null; name: string; size: number }) {
  const [aspect, setAspect] = useState(1)
  if (!uri) {
    if (!name) return null
    return (
      <View className="bg-accent-500 items-center justify-center" style={{ width: size, height: size, borderRadius: size / 2 }}>
        <Text className="text-white font-bold" style={{ fontSize: size * 0.38 }}>{initials(name)}</Text>
      </View>
    )
  }
  const round = Math.abs(aspect - 1) < 0.05
  return (
    <Image
      source={{ uri }}
      accessibilityLabel={`${name} Logo`}
      contentFit="contain"
      onLoad={e => e.source.height && setAspect(e.source.width / e.source.height)}
      style={{ height: size, width: size * aspect, borderRadius: round ? size / 2 : 0 }}
    />
  )
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  const idx = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <Text className="bg-accent-100 dark:bg-accent-900/40 text-accent-700 dark:text-accent-300 font-semibold">
        {text.slice(idx, idx + q.length)}
      </Text>
      {text.slice(idx + q.length)}
    </>
  )
}

/** Product result rows while a search runs: thumb, name, price. */
function ResultsSkeleton() {
  return (
    <View className="py-1" accessible accessibilityLabel="Searching">
      <View className="px-4 pt-3 pb-1.5">
        <Skeleton height={10} width={64} rounded="rounded" />
      </View>
      {(['70%', '55%', '80%', '62%'] as const).map((w, i) => (
        <View key={i} className="flex-row items-center gap-3 px-4 py-2.5">
          <Skeleton width={40} height={40} />
          <View className="flex-1 gap-1.5">
            <Skeleton height={13} width={w} />
            <Skeleton height={10} width={56} rounded="rounded" />
          </View>
        </View>
      ))}
    </View>
  )
}

/** 44px icon button; `scale` mirrors the web's active:scale-*. */
function IconButton({ onPress, label, scale = 1, children }: { onPress: () => void; label: string; scale?: number; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={4}>
      {({ pressed }) => (
        <View className="p-2.5 min-w-[44px] min-h-[44px] items-center justify-center rounded-lg" style={{ transform: [{ scale: pressed ? scale : 1 }] }}>
          {children}
        </View>
      )}
    </Pressable>
  )
}

interface TopNavProps {
  onSearchPress?: () => void
}

export default function TopNav({ onSearchPress }: TopNavProps) {
  const router = useRouter()
  const pathname = usePathname()
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const t = useTokens()
  const qc = useQueryClient()
  const { colorScheme } = useColorScheme()
  const isDark = colorScheme === 'dark'
  const setColorScheme = useThemeStore(s => s.setColorScheme)
  const cartCount = useCartStore(s => s.count)
  const resetCart = useCartStore(s => s.reset)
  const user = useAuthStore(s => s.user)
  const clearAuth = useAuthStore(s => s.clearAuth)
  const { identity } = useStoreConfig()

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [kb, setKb] = useState(0)
  const inputRef = useRef<TextInput>(null)

  const drawerWidth = Math.min(width * 0.8, 320)
  const slide = useRef(new Animated.Value(0)).current

  const { data: wishlist } = useQuery({ queryKey: ['wishlist'], queryFn: getWishlist, enabled: !!user, staleTime: 60_000 })
  const wishlistCount = user ? wishlist?.length ?? 0 : 0

  // Recent searches, refetched each time the overlay opens (web: GET on open).
  const historyKey = ['search-history', user?.id ?? null]
  const { data: history = [] } = useQuery({
    queryKey: historyKey,
    queryFn: () => api<{ history: string[] }>('/api/user/search-history').then(d => (Array.isArray(d.history) ? d.history : [])).catch(() => []),
    enabled: searchOpen,
    staleTime: 0,
  })

  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 200)
    return () => clearTimeout(id)
  }, [query])

  const live = query.trim().length >= 2 && debounced.trim().length >= 2
  const { data: results, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<SearchResult>(`/api/search?q=${encodeURIComponent(debounced)}`),
    enabled: searchOpen && debounced.trim().length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const categories = live ? results?.categories ?? [] : []
  const products = live ? results?.products ?? [] : []
  const isLoading = live && isFetching

  useEffect(() => {
    if (!searchOpen) return
    // In window coordinates on edge-to-edge Android too (RN's event leaves out the nav bar).
    const show = KeyboardEvents.addListener('keyboardDidShow', e => setKb(e.height))
    const hide = KeyboardEvents.addListener('keyboardDidHide', () => setKb(0))
    return () => { show.remove(); hide.remove() }
  }, [searchOpen])

  // ── Drawer ──
  const openDrawer = () => {
    setDrawerOpen(true)
    Animated.timing(slide, { toValue: 1, duration: 300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start()
  }
  const closeDrawer = (after?: () => void) => {
    Animated.timing(slide, { toValue: 0, duration: 300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }).start(() => {
      setDrawerOpen(false)
      after?.()
    })
  }
  // Navigate like a web <Link>: go now and let the drawer slide out; modal routes wait for it to close.
  const go = (nav: () => void, afterClose = false) => {
    if (afterClose) return closeDrawer(nav)
    nav()
    closeDrawer()
  }
  const navTo = (href: string) => {
    if (href === '/') return go(() => router.navigate('/(tabs)'))
    if (href === '/products') return go(() => router.navigate('/(tabs)/products'))
    if (href === '/categories') return go(() => router.push('/categories'))
    go(() => openHref(router, href))
  }
  const handleLogout = async () => {
    closeDrawer()
    await logout()
    await clearAuth()
    resetCart()
    qc.clear()
  }

  // ── Search ──
  const openSearch = () => (onSearchPress ? onSearchPress() : setSearchOpen(true))
  const closeSearch = () => {
    setSearchOpen(false)
    setQuery('')
    setDebounced('')
  }
  const saveHistory = (term: string) => {
    const cleaned = term.trim()
    if (!cleaned) return
    api('/api/user/search-history', { method: 'POST', body: JSON.stringify({ query: cleaned }) }).catch(() => {})
    qc.setQueryData<string[]>(historyKey, prev => [cleaned, ...(prev ?? []).filter(q => q.toLowerCase() !== cleaned.toLowerCase())].slice(0, 5))
  }
  const clearHistory = () => {
    api('/api/user/search-history', { method: 'DELETE' }).catch(() => {})
    qc.setQueryData<string[]>(historyKey, [])
  }
  const searchFor = (q: string) => {
    closeSearch()
    router.push({ pathname: '/(tabs)/products', params: { search: q.trim() } })
  }
  const submit = () => {
    if (!query.trim()) return
    saveHistory(query)
    searchFor(query)
  }

  const showHistoryPanel = searchOpen && query.trim().length === 0 && history.length > 0
  const showResultsPanel = searchOpen && !showHistoryPanel && (query.trim().length >= 2 || isLoading)
  const hasResults = categories.length > 0 || products.length > 0
  const panelMax = Math.min(height - 128, height - insets.top - 12 - 46 - 12 - kb - 16)

  const drawerX = slide.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth, 0] })
  const iconColor = t.foregroundSecondary

  return (
    <>
      <View
        style={{ paddingTop: insets.top, boxShadow: isDark ? undefined : SHADOW_SM, zIndex: 40 }}
        className="bg-surface-elevated dark:border-b dark:border-border-default"
      >
        <View className="px-3 h-16 flex-row items-center justify-between gap-3">
          <Pressable onPress={() => router.navigate('/(tabs)')} className="flex-row items-center gap-2 shrink" accessibilityRole="link">
            <StoreLogo uri={identity.logoUrl} name={identity.name} size={32} />
            <Text className="text-base font-bold text-secondary-500 dark:text-primary-400 shrink" numberOfLines={1}>
              {identity.name}
            </Text>
          </Pressable>

          <View className="flex-row items-center gap-1 shrink-0">
            <IconButton onPress={openSearch} label="Search">
              <Search size={24} color={iconColor} />
            </IconButton>
            <IconButton onPress={() => router.navigate('/(tabs)/cart')} label={cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart'}>
              <ShoppingCart size={24} color={iconColor} />
              {cartCount > 0 && (
                <View className="absolute right-0.5 top-0.5 h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent-500 px-1">
                  <Text className="text-[10px] font-black leading-none text-white">{cartCount > 99 ? '99+' : cartCount}</Text>
                </View>
              )}
            </IconButton>
            <IconButton
              onPress={() => (user ? router.navigate('/(tabs)/account') : router.push('/(auth)/login'))}
              label={user ? 'My account' : 'Sign in'}
            >
              <User size={24} color={iconColor} />
            </IconButton>
            <IconButton onPress={openDrawer} label="Open menu" scale={0.9}>
              <Menu size={24} color={iconColor} />
            </IconButton>
          </View>
        </View>
      </View>

      {/* Search overlay */}
      <Modal visible={searchOpen} transparent animationType="fade" statusBarTranslucent onRequestClose={closeSearch}>
        <View className="flex-1">
          <Pressable className="absolute inset-0 bg-slate-900/35" onPress={closeSearch} accessibilityLabel="Close search" />
          <View style={{ position: 'absolute', top: insets.top + 12, left: 16, right: 16, alignSelf: 'center', maxWidth: 640 }}>
            <View className="justify-center">
              <TextInput
                ref={inputRef}
                autoFocus
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={submit}
                placeholder="Search products, categories..."
                placeholderTextColor={t.foregroundMuted}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
                className="h-[46px] pl-11 pr-24 py-0 rounded-full border border-border-secondary bg-surface-elevated text-foreground"
                style={{ boxShadow: SHADOW_LG, fontSize: 14 }}
              />
              <View pointerEvents="none" className="absolute left-4">
                <Search size={20} color={t.foregroundMuted} />
              </View>
              <View className="absolute right-2 flex-row items-center gap-1">
                {query.length > 0 && (
                  <Pressable
                    onPress={() => { setQuery(''); setDebounced(''); inputRef.current?.focus() }}
                    className="p-1.5 rounded-full"
                    accessibilityLabel="Clear text"
                  >
                    <CircleX size={16} color={t.surfaceElevated} fill={t.foregroundMuted} />
                  </Pressable>
                )}
                <Pressable onPress={closeSearch} className="p-1.5 rounded-full" accessibilityLabel="Close search">
                  <X size={16} color={t.foregroundSecondary} />
                </Pressable>
              </View>
            </View>

            {showHistoryPanel && (
              <View className="mt-3 rounded-2xl" style={{ boxShadow: SHADOW_XL }}>
                <View className="bg-surface-elevated rounded-2xl border border-border-default overflow-hidden">
                  <View className="px-4 pt-3 pb-1 flex-row items-center justify-between">
                    <Text className="text-xs font-semibold uppercase text-foreground-muted" style={{ letterSpacing: 0.6 }}>
                      Recent Searches
                    </Text>
                    <Pressable onPress={clearHistory} hitSlop={8}>
                      <Text className="text-xs text-foreground-muted">Clear</Text>
                    </Pressable>
                  </View>
                  <View className="py-1">
                    {history.map(q => (
                      <TouchableOpacity key={q} activeOpacity={0.7} onPress={() => searchFor(q)} className="flex-row items-center gap-3 px-4 py-2.5">
                        <View className="w-7 h-7 rounded-md bg-surface-secondary items-center justify-center">
                          <Clock size={14} color={t.foregroundMuted} />
                        </View>
                        <Text className="text-sm text-foreground">{q}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>
            )}

            {showResultsPanel && (
              <View className="mt-3 rounded-2xl" style={{ boxShadow: SHADOW_XL }}>
                <View className="bg-surface-elevated rounded-2xl border border-border-default overflow-hidden">
                  <ScrollView style={{ maxHeight: Math.max(panelMax, 120) }} keyboardShouldPersistTaps="handled">
                    {isLoading ? (
                      <ResultsSkeleton />
                    ) : hasResults ? (
                      <View className="py-1">
                        {categories.length > 0 && (
                          <>
                            <Text className="px-4 pt-2 pb-1 text-xs font-semibold uppercase text-foreground-muted" style={{ letterSpacing: 0.6 }}>
                              Categories
                            </Text>
                            {categories.map(cat => (
                              <TouchableOpacity
                                key={cat.id}
                                activeOpacity={0.7}
                                onPress={() => {
                                  saveHistory(query)
                                  closeSearch()
                                  router.push(`/category/${cat.slug}`)
                                }}
                                className="flex-row items-center gap-3 px-4 py-2.5"
                              >
                                <View className="w-7 h-7 rounded-md bg-accent-100 dark:bg-accent-900/30 items-center justify-center">
                                  <Layers size={14} color={isDark ? accent[400] : accent[600]} />
                                </View>
                                <Text className="text-sm text-foreground flex-1">
                                  <Highlight text={cat.name} query={query} />
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </>
                        )}

                        {products.length > 0 && (
                          <>
                            <Text className="px-4 pt-3 pb-1 text-xs font-semibold uppercase text-foreground-muted" style={{ letterSpacing: 0.6 }}>
                              Products
                            </Text>
                            {products.map(product => {
                              const img = product.product_images?.find(i => i.is_primary) || product.product_images?.[0]
                              const price = product.has_variants && product.variant_min_price
                                ? product.variant_min_price
                                : product.price_ex_gst || product.base_price
                              return (
                                <TouchableOpacity
                                  key={product.id}
                                  activeOpacity={0.7}
                                  onPress={() => {
                                    saveHistory(query)
                                    closeSearch()
                                    router.push(`/product/${product.slug}`)
                                  }}
                                  className="flex-row items-center gap-3 px-4 py-2.5"
                                >
                                  <View className="w-10 h-10 bg-surface-secondary rounded-lg overflow-hidden border border-border-default items-center justify-center">
                                    {img ? (
                                      <Image source={{ uri: img.thumbnail_url }} contentFit="contain" style={{ width: 36, height: 36 }} />
                                    ) : (
                                      <ImageIcon size={20} strokeWidth={1} color={t.foregroundMuted} />
                                    )}
                                  </View>
                                  <View className="flex-1 min-w-0">
                                    <Text className="text-sm font-medium text-foreground" numberOfLines={1}>
                                      <Highlight text={product.name} query={query} />
                                    </Text>
                                    <Text className="text-xs text-accent-600 dark:text-accent-400 font-semibold mt-0.5">
                                      {product.has_variants ? 'From ' : ''}₹{inr(price)}
                                    </Text>
                                  </View>
                                  <ChevronRight size={16} color={t.foregroundMuted} />
                                </TouchableOpacity>
                              )
                            })}
                          </>
                        )}

                        <View className="border-t border-border-default p-3">
                          <TouchableOpacity
                            activeOpacity={0.7}
                            onPress={() => { saveHistory(query); searchFor(query) }}
                            className="flex-row items-center justify-center gap-1.5"
                          >
                            <Search size={16} color={isDark ? accent[400] : accent[600]} />
                            <Text className="text-sm text-accent-600 dark:text-accent-400 font-medium" numberOfLines={1}>
                              See all results for &quot;{query}&quot;
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ) : query.trim().length >= 2 ? (
                      <View className="py-10 items-center">
                        <View className="mb-3" style={{ opacity: 0.4 }}>
                          <Search size={40} strokeWidth={1} color={t.foregroundMuted} />
                        </View>
                        <Text className="text-sm font-medium text-foreground-muted text-center">No results for &quot;{query}&quot;</Text>
                        <Text className="text-xs mt-1 text-foreground-muted text-center" style={{ opacity: 0.7 }}>Try a different term</Text>
                      </View>
                    ) : null}
                  </ScrollView>
                </View>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Mobile drawer */}
      <Modal visible={drawerOpen} transparent animationType="none" statusBarTranslucent onRequestClose={() => closeDrawer()}>
        <View className="flex-1">
          <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: slide }}>
            <Pressable className="flex-1 bg-black/50" onPress={() => closeDrawer()} accessibilityLabel="Close menu" />
          </Animated.View>

          <Animated.View
            className="bg-surface-elevated"
            style={{
              position: 'absolute', top: 0, left: 0, bottom: 0, width: drawerWidth,
              transform: [{ translateX: drawerX }], boxShadow: SHADOW_XL,
              paddingTop: insets.top, paddingBottom: insets.bottom,
            }}
          >
            <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
              <View className="flex-row items-center justify-between p-4 border-b border-border-default">
                <Pressable onPress={() => navTo('/')} className="flex-row items-center gap-2 shrink" accessibilityRole="link">
                  <StoreLogo uri={identity.logoUrl} name={identity.name} size={40} />
                  <Text className="text-base font-bold text-secondary-500 dark:text-primary-400 shrink" numberOfLines={1}>
                    {identity.name}
                  </Text>
                </Pressable>
                <Pressable onPress={() => closeDrawer()} className="p-2 rounded-lg" accessibilityLabel="Close menu">
                  <X size={24} color={t.foregroundMuted} />
                </Pressable>
              </View>

              <View className="p-4 gap-1">
                {NAV_LINKS.map(link => {
                  const active = pathname === link.href
                  return (
                    <TouchableOpacity
                      key={link.href}
                      activeOpacity={0.7}
                      onPress={() => navTo(link.href)}
                      className={active ? 'px-4 py-3 rounded-lg bg-accent-50 dark:bg-accent-900/30' : 'px-4 py-3 rounded-lg'}
                    >
                      <Text className={active ? 'font-medium text-accent-700 dark:text-accent-400' : 'font-medium text-foreground-secondary'}>
                        {link.label}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

              <View className="border-t border-border-default mx-4" />

              <View className="p-4 gap-1">
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => go(() => router.navigate('/(tabs)/cart'))}
                  className="flex-row items-center justify-between px-4 py-3 rounded-lg"
                >
                  <Text className="font-medium text-foreground-secondary">Cart</Text>
                  {cartCount > 0 && (
                    <View className="bg-accent-500 rounded-full px-2 py-0.5">
                      <Text className="text-white text-xs font-bold">{cartCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.7}
                  onPress={() => go(() => router.navigate('/(tabs)/wishlist'))}
                  className="flex-row items-center justify-between px-4 py-3 rounded-lg"
                >
                  <Text className="font-medium text-foreground-secondary">Wishlist</Text>
                  {wishlistCount > 0 && (
                    <View className="bg-red-500 rounded-full px-2 py-0.5">
                      <Text className="text-white text-xs font-bold">{wishlistCount}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>

              <View className="border-t border-border-default mx-4" />

              <View className="p-4 gap-1">
                {user ? (
                  <>
                    <View className="flex-row items-center gap-3 px-4 py-2">
                      <View className="w-10 h-10 rounded-full overflow-hidden shrink-0">
                        {(user as { avatarUrl?: string | null }).avatarUrl ? (
                          <Image source={{ uri: (user as { avatarUrl?: string }).avatarUrl }} contentFit="cover" style={{ width: 40, height: 40 }} />
                        ) : (
                          <View className="w-full h-full bg-accent-500 items-center justify-center">
                            <Text className="text-white font-semibold">
                              {`${user.firstName?.charAt(0) ?? ''}${user.lastName?.charAt(0) || ''}`.toUpperCase()}
                            </Text>
                          </View>
                        )}
                      </View>
                      <View className="flex-1 min-w-0">
                        <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                          {user.firstName} {user.lastName}
                        </Text>
                        <Text className="text-xs text-foreground-muted" numberOfLines={1}>{user.email}</Text>
                      </View>
                    </View>
                    <TouchableOpacity activeOpacity={0.7} onPress={() => go(() => router.navigate('/(tabs)/account'))} className="px-4 py-3 rounded-lg">
                      <Text className="font-medium text-foreground-secondary">My Account</Text>
                    </TouchableOpacity>
                    <TouchableOpacity activeOpacity={0.7} onPress={() => go(() => router.push('/orders'))} className="px-4 py-3 rounded-lg">
                      <Text className="font-medium text-foreground-secondary">My Orders</Text>
                    </TouchableOpacity>
                    <TouchableOpacity activeOpacity={0.7} onPress={handleLogout} className="px-4 py-3 rounded-lg">
                      <Text className="font-medium text-red-600 dark:text-red-400">Logout</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    <TouchableOpacity
                      activeOpacity={0.8}
                      onPress={() => go(() => router.push('/(auth)/login'), true)}
                      className="px-4 py-3 rounded-lg bg-accent-500"
                    >
                      <Text className="text-white text-center font-medium">Login</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => go(() => router.push('/(auth)/signup'), true)}
                      className="px-4 py-3 rounded-lg"
                    >
                      <Text className="text-center font-medium text-foreground-secondary">Sign Up</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>

              <View className="mt-auto p-4 border-t border-border-default">
                <View className="flex-row items-center justify-between px-4">
                  <Text className="text-sm text-foreground-muted">Theme</Text>
                  <IconButton onPress={() => setColorScheme(isDark ? 'light' : 'dark')} label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
                    {isDark ? <Sun size={20} strokeWidth={1.5} color={iconColor} /> : <Moon size={20} strokeWidth={1.5} color={iconColor} />}
                  </IconButton>
                </View>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  )
}
