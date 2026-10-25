import { useEffect, useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, TextInput, TouchableOpacity, View, useWindowDimensions } from 'react-native'
import { Image } from 'expo-image'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { KeyboardEvents } from 'react-native-keyboard-controller'
import { useRouter } from 'expo-router'
import { useColorScheme } from 'nativewind'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, CircleX, Clock, ImageIcon, Layers, Menu, Search, ShoppingCart, User, X } from 'lucide-react-native'
import { api } from '../../api/client'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useCartStore } from '../../stores/cartStore'
import { useAuthStore } from '../../stores/authStore'
import { inr } from '../../lib/format'
import { accent, useTokens } from '../../theme'
import { IconButton, Text, Skeleton, useElevation, useMotion } from '../../ui'
import { MenuSheet } from './MenuSheet'
import { StoreLogo } from './StoreLogo'

// Mirror of controller-service visitor/Header.tsx + SearchBar.tsx at the mobile breakpoint; the menu is MenuSheet.

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

interface TopNavProps {
  onSearchPress?: () => void
}

export default function TopNav({ onSearchPress }: TopNavProps) {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const t = useTokens()
  const qc = useQueryClient()
  const { colorScheme } = useColorScheme()
  const isDark = colorScheme === 'dark'
  const { animate } = useMotion()
  const barShadow = useElevation('raised')
  const fieldShadow = useElevation('overlay')
  const panelShadow = useElevation('floating')
  const cartCount = useCartStore(s => s.count)
  const user = useAuthStore(s => s.user)
  const { identity } = useStoreConfig()

  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [kb, setKb] = useState(0)
  const inputRef = useRef<TextInput>(null)


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

  const iconColor = t.foregroundSecondary

  return (
    <>
      <View
        style={[{ paddingTop: insets.top, zIndex: 40 }, barShadow]}
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
            <IconButton icon={Search} label="Search" color={iconColor} onPress={openSearch} />
            <IconButton
              icon={ShoppingCart}
              label="Cart"
              badge={cartCount}
              accessibilityLabel={cartCount > 0 ? `Cart, ${cartCount} items` : 'Cart'}
              color={iconColor}
              onPress={() => router.navigate('/(tabs)/cart')}
            />
            <IconButton
              icon={User}
              label={user ? 'My account' : 'Sign in'}
              color={iconColor}
              onPress={() => (user ? router.navigate('/(tabs)/account') : router.push('/(auth)/login'))}
            />
            <IconButton icon={Menu} label="Open menu" color={iconColor} onPress={() => setMenuOpen(true)} />
          </View>
        </View>
      </View>

      {/* Search overlay */}
      <Modal visible={searchOpen} transparent animationType={animate ? 'fade' : 'none'} statusBarTranslucent onRequestClose={closeSearch}>
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
                style={[fieldShadow, { fontSize: 14 }]}
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
              <View className="mt-3 rounded-2xl" style={panelShadow}>
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
              <View className="mt-3 rounded-2xl" style={panelShadow}>
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

      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  )
}
