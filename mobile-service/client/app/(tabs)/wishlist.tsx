import { useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Heart, ImageIcon, ShoppingCart, X } from 'lucide-react-native'
import TopNav from '../../src/components/layout/TopNav'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import WarningBadges from '../../src/components/cart/WarningBadges'
import FeaturedProducts from '../../src/components/account/FeaturedProducts'
import { money } from '../../src/components/cart/lines'
import { getWishlist, removeFromWishlist } from '../../src/api/wishlist'
import { addToCart, createBuyNowIntent } from '../../src/api/cart'
import { useAuthStore } from '../../src/stores/authStore'
import { showToast } from '../../src/stores/toastStore'
import { openHref } from '../../src/lib/links'
import { status, useTokens } from '../../src/theme'
import { Screen, Skeleton, Text, useBottomInset } from '../../src/ui'

// Mirror of controller-service app/(storefront)/wishlist/page.tsx at the mobile breakpoint.

interface WishlistRow {
  id: string
  product_id: string
  snapshot_price: number | string | null
  snapshot_in_stock: boolean | null
  inventory_in_stock: boolean | null
  products: {
    id: string
    name: string
    slug: string
    base_price: number
    price_ex_gst: number | null
    mrp: number | null
    has_variants: boolean
    is_digital?: boolean
    stock_status: string
    variant_stock_total: number
    variant_min_price: number | null
    variant_min_mrp: number | null
    product_images: Array<{ thumbnail_url: string; is_primary: boolean }>
    fragile: boolean | null
    hazardous: boolean | null
    flammable: boolean | null
  }
}

type Filter = 'all' | 'in' | 'out'
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['in', 'In Stock'],
  ['out', 'Out of Stock'],
]

// controller-service components/visitor/account/wishlist-badges.ts
function wishlistBadges(i: {
  hasVariants: boolean
  shownPrice: number
  shownInStock: boolean
  basePrice: number | string | null
  inventoryInStock: boolean | null
  snapshotPrice: number | string | null
  snapshotInStock: boolean | null
}) {
  const backInStock = i.snapshotInStock === false && i.inventoryInStock === true && i.shownInStock
  const snapshot = Number(i.snapshotPrice)
  const current = Number(i.basePrice)
  let priceDrop: { was: number; pct: number } | null = null
  if (!i.hasVariants && snapshot > 0 && current > 0 && current < snapshot && i.shownPrice > 0) {
    const pct = Math.round(((snapshot - current) / snapshot) * 100)
    if (pct >= 1) priceDrop = { was: Math.round(((i.shownPrice * snapshot) / current) * 100) / 100, pct }
  }
  return { backInStock, priceDrop }
}

/** A wishlist card while the list loads: image, remove button, title, price, stock and the cart button. */
function WishlistCardSkeleton() {
  return (
    <View className="overflow-hidden rounded-lg border border-border-default bg-surface-elevated">
      <View className="mx-3 mt-3">
        <Skeleton aspectRatio={5 / 3} />
      </View>
      <View className="p-4">
        <Skeleton width={28} height={28} rounded="rounded-full" className="mb-1 self-end" />
        <View className="mb-2 min-h-[48px] gap-2">
          <Skeleton height={15} />
          <Skeleton height={15} width="65%" />
        </View>
        <Skeleton height={24} width="40%" className="mb-2 mt-1" />
        <Skeleton height={10} width={110} rounded="rounded" className="mb-3" />
        <Skeleton height={12} width={64} rounded="rounded" className="mb-3" />
        <Skeleton height={36} />
      </View>
    </View>
  )
}

function EmptyCard({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  const t = useTokens()
  return (
    <View className="items-center rounded-lg border border-border-default bg-surface-elevated p-12 shadow-sm">
      <View className="mb-4">
        <Heart size={64} color={t.foregroundMuted} strokeWidth={1.5} />
      </View>
      <Text className="mb-2 text-center text-xl font-semibold text-foreground">{title}</Text>
      <Text className="mb-6 text-center text-foreground-secondary">{body}</Text>
      <Pressable onPress={onAction} className="rounded-lg bg-accent-500 px-8 py-3 active:bg-accent-600">
        <Text className="font-semibold text-white">{action}</Text>
      </Pressable>
    </View>
  )
}

export default function WishlistScreen() {
  const bottomInset = useBottomInset()
  const router = useRouter()
  const qc = useQueryClient()
  const t = useTokens()
  const user = useAuthStore(s => s.user)
  const [filter, setFilter] = useState<Filter>('all')
  const [busy, setBusy] = useState<Set<string>>(new Set())

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ['wishlist'],
    queryFn: getWishlist,
    enabled: !!user,
  })
  const items = (data ?? []) as unknown as WishlistRow[]

  const inStockOf = (i: WishlistRow) =>
    i.products.has_variants ? Number(i.products.variant_stock_total) > 0 : i.products.stock_status !== 'Out of Stock'
  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter(i => (filter === 'in' ? inStockOf(i) : !inStockOf(i)))),
    [items, filter]
  )

  const mark = (id: string, on: boolean) =>
    setBusy(prev => {
      const next = new Set(prev)
      if (on) next.add(id)
      else next.delete(id)
      return next
    })

  const handleRemove = (productId: string) =>
    Alert.alert('Remove from Wishlist', 'Are you sure you want to remove this item from your wishlist?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeFromWishlist(productId)
            await qc.invalidateQueries({ queryKey: ['wishlist'] })
            showToast('Item removed from wishlist', 'success')
          } catch {
            showToast('Failed to remove item', 'error')
          }
        },
      },
    ])

  // Digital products never enter the cart: Buy Now, or pick options on the product page.
  const handleBuyNow = async (productId: string, slug: string, hasVariants: boolean) => {
    if (hasVariants) return router.push(`/product/${slug}`)
    mark(productId, true)
    try {
      const intent = await createBuyNowIntent({ productId, qty: 1 })
      router.push({ pathname: '/checkout/review', params: { intent } })
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Failed to start checkout', 'error')
    } finally {
      mark(productId, false)
    }
  }

  const handleAddToCart = async (productId: string) => {
    mark(productId, true)
    try {
      await addToCart({ product_id: productId, quantity: 1 })
      qc.invalidateQueries({ queryKey: ['cart'] })
      // Moving it to the cart takes it off the wishlist.
      try {
        await removeFromWishlist(productId)
        await qc.invalidateQueries({ queryKey: ['wishlist'] })
        showToast('Moved to cart', 'success')
      } catch {
        showToast('Item added to cart!', 'success')
      }
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Failed to add to cart', 'error')
    } finally {
      mark(productId, false)
    }
  }

  if (!user) {
    return (
      <Screen header={<TopNav />}>
        <EmptyCard
          title="Sign in to view your wishlist"
          body="Save your favorite items to buy them later"
          action="Sign In"
          onAction={() => router.push('/(auth)/login')}
        />
      </Screen>
    )
  }

  // The account hero runs edge to edge, so these own their ScrollView (Screen's content has a gutter).
  if (isLoading) {
    return (
      <Screen header={<TopNav />} mode="none">
        <ScrollView scrollEnabled={false} showsVerticalScrollIndicator={false}>
          <AccountMobileHeader />
          <View className="px-4 py-4">
            <View className="mb-4 flex-row gap-1.5">
              {[40, 72, 98].map((w, i) => (
                <Skeleton key={i} width={w} height={24} rounded="rounded-full" />
              ))}
            </View>
            <View className="gap-4">
              <WishlistCardSkeleton />
              <WishlistCardSkeleton />
            </View>
          </View>
        </ScrollView>
      </Screen>
    )
  }

  const refreshControl = <RefreshControl refreshing={isRefetching} onRefresh={refetch} />

  if (items.length === 0) {
    return (
      <Screen header={<TopNav />} mode="none">
        <ScrollView refreshControl={refreshControl} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottomInset }}>
          <AccountMobileHeader />
          <View className="px-4 py-4">
            <EmptyCard
              title="Your wishlist is empty"
              body="Save your favorite items to buy them later"
              action="Browse Products"
              onAction={() => openHref(router, '/products')}
            />
          </View>
        </ScrollView>
      </Screen>
    )
  }

  return (
    <Screen header={<TopNav />} mode="none">
      <ScrollView refreshControl={refreshControl} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: bottomInset }}>
        <AccountMobileHeader />
        <View className="px-4 py-4">
          <View className="mb-4 flex-row items-center gap-1.5">
            {FILTERS.map(([val, label]) => (
              <Pressable
                key={val}
                onPress={() => setFilter(val)}
                className={`rounded-full px-3 py-1 ${filter === val ? 'bg-accent-500' : 'border border-border-default bg-surface-elevated'}`}
              >
                <Text className={`text-xs font-medium ${filter === val ? 'text-white' : 'text-foreground-secondary'}`}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <View className="gap-4">
            {filtered.map(item => {
              const p = item.products
              const image = p.product_images?.find(i => i.is_primary) || p.product_images?.[0]
              const hasVariants = p.has_variants
              const price = Number(hasVariants && p.variant_min_price ? p.variant_min_price : p.price_ex_gst || p.base_price)
              const effectiveStock = hasVariants ? Number(p.variant_stock_total) : p.stock_status !== 'Out of Stock' ? 1 : 0
              const isDigital = !!p.is_digital
              const inStock = isDigital || effectiveStock > 0
              const mrp = p.mrp ? Number(p.mrp) : p.variant_min_mrp ? Number(p.variant_min_mrp) : null
              const inclPrice = hasVariants && p.variant_min_price ? Number(p.variant_min_price) : Number(p.base_price)
              const mrpDiscount = mrp && mrp > inclPrice ? Math.round(((mrp - inclPrice) / mrp) * 100) : 0
              const adding = busy.has(item.product_id)
              const badges = wishlistBadges({
                hasVariants,
                shownPrice: price,
                shownInStock: inStock,
                basePrice: p.base_price,
                inventoryInStock: item.inventory_in_stock,
                snapshotPrice: item.snapshot_price,
                snapshotInStock: item.snapshot_in_stock,
              })
              const open = () => router.push(`/product/${p.slug}`)

              return (
                <View key={item.id} className="overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-sm">
                  <Pressable
                    onPress={open}
                    className="relative mx-3 mt-3 overflow-hidden rounded-lg border-b border-border-default"
                    style={{ aspectRatio: 5 / 3 }}
                  >
                    {image ? (
                      <>
                        <Image
                          source={{ uri: image.thumbnail_url }}
                          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.6, transform: [{ scale: 1.1 }] }}
                          contentFit="cover"
                          blurRadius={24}
                        />
                        <Image source={{ uri: image.thumbnail_url }} style={{ width: '100%', height: '100%' }} contentFit="contain" />
                      </>
                    ) : (
                      <View className="flex-1 items-center justify-center">
                        <ImageIcon size={80} color={t.foregroundMuted} strokeWidth={1} />
                      </View>
                    )}
                    {mrpDiscount > 0 && (
                      <View className="absolute right-3 top-3 rounded-full bg-accent-500 px-2 py-1">
                        <Text className="text-xs font-semibold text-white">{mrpDiscount}% off</Text>
                      </View>
                    )}
                    {(badges.backInStock || badges.priceDrop) && (
                      <View className="absolute left-3 top-3 items-start gap-1">
                        {badges.backInStock && (
                          <View className="rounded-full bg-emerald-600 px-2 py-1">
                            <Text className="text-xs font-semibold text-white">Back in stock</Text>
                          </View>
                        )}
                        {badges.priceDrop && (
                          <View className="rounded-full bg-rose-600 px-2 py-1">
                            <Text className="text-xs font-semibold text-white">Price dropped {badges.priceDrop.pct}%</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </Pressable>

                  <View className="p-4">
                    <Pressable
                      onPress={() => handleRemove(item.product_id)}
                      accessibilityLabel="Remove from wishlist"
                      hitSlop={6}
                      className="mb-1 self-end rounded-full p-1.5 active:bg-red-50 dark:active:bg-red-900/30"
                    >
                      <X size={16} color={status.heart} strokeWidth={2} />
                    </Pressable>

                    <Pressable onPress={open}>
                      <Text className="mb-2 min-h-[48px] text-base font-semibold text-foreground" numberOfLines={2}>
                        {p.name}
                      </Text>
                    </Pressable>
                    <WarningBadges fragile={p.fragile} hazardous={p.hazardous} flammable={p.flammable} size="xs" />

                    <View className="mb-1 mt-1 flex-row items-baseline gap-2">
                      <Text className="text-xl font-bold text-primary-600 dark:text-primary-400">
                        {hasVariants ? 'From ' : ''}
                        {money(price)}
                      </Text>
                      {mrp && mrp > price ? <Text className="text-sm text-foreground-muted line-through">{money(mrp)}</Text> : null}
                    </View>
                    {badges.priceDrop && (
                      <Text className="mb-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                        Was <Text className="line-through">{money(badges.priceDrop.was)}</Text>
                      </Text>
                    )}
                    <Text className="mb-3 text-[10px] text-foreground-muted">Inclusive of all taxes</Text>

                    <View className="mb-3 flex-row items-center justify-between">
                      <Text className={`text-xs font-medium ${inStock ? 'text-green-600' : 'text-red-600'}`}>
                        {inStock ? 'In Stock' : 'Out of Stock'}
                      </Text>
                    </View>

                    <Pressable
                      onPress={() => (isDigital ? handleBuyNow(item.product_id, p.slug, hasVariants) : handleAddToCart(item.product_id))}
                      disabled={!inStock || adding}
                      className={`w-full flex-row items-center justify-center gap-2 rounded-lg px-4 py-2 ${!inStock || adding ? 'bg-border-default' : 'bg-accent-500 active:bg-accent-600'}`}
                    >
                      {adding ? (
                        <>
                          <ActivityIndicator size="small" color={t.foregroundMuted} />
                          <Text className="text-sm font-semibold text-foreground-muted">{isDigital ? 'Processing...' : 'Adding...'}</Text>
                        </>
                      ) : (
                        <>
                          <ShoppingCart size={16} color={inStock ? status.white : t.foregroundMuted} strokeWidth={2} />
                          <Text className={`text-sm font-semibold ${inStock ? 'text-white' : 'text-foreground-muted'}`}>
                            {isDigital ? 'Buy Now' : 'Add to Cart'}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  </View>
                </View>
              )
            })}
          </View>

          <FeaturedProducts />
        </View>
      </ScrollView>
    </Screen>
  )
}
