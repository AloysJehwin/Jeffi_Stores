import { useMemo, useState } from 'react'
import { Pressable, RefreshControl, ScrollView, View } from 'react-native'
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
import { openHref } from '../../src/lib/links'
import { status, useTokens } from '../../src/theme'
import {
  Button, Card, Chip, ChipGroup, EmptyState, IconButton, List, Pill, Screen, Skeleton, Text, confirm, toast, useBottomInset,
} from '../../src/ui'

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
    <View className="overflow-hidden rounded-panel bg-surface-elevated dark:border dark:border-border-default">
      <View className="mx-3 mt-3">
        <Skeleton aspectRatio={5 / 3} rounded="rounded-xl" />
      </View>
      <View className="p-4">
        <Skeleton width={28} height={28} rounded="rounded-full" className="mb-1 self-end" />
        <View className="mb-2 min-h-[48px] gap-2">
          <Skeleton height={15} />
          <Skeleton height={15} width="65%" />
        </View>
        <Skeleton height={24} width="40%" className="mb-2 mt-1" />
        <Skeleton height={11} width={110} rounded="rounded" className="mb-3" />
        <Skeleton height={12} width={64} rounded="rounded" className="mb-3" />
        <Skeleton height={48} rounded="rounded-field" />
      </View>
    </View>
  )
}

function EmptyCard({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }) {
  return (
    <Card padded={false}>
      <EmptyState icon={Heart} title={title} message={body} actionLabel={action} onAction={onAction} />
    </Card>
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

  const handleRemove = async (productId: string) => {
    const ok = await confirm({
      title: 'Remove from wishlist?',
      message: 'Are you sure you want to remove this item from your wishlist?',
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!ok) return
    try {
      await removeFromWishlist(productId)
      await qc.invalidateQueries({ queryKey: ['wishlist'] })
      toast.success('Item removed from wishlist')
    } catch {
      toast.error('Failed to remove item')
    }
  }

  // Digital products never enter the cart: Buy Now, or pick options on the product page.
  const handleBuyNow = async (productId: string, slug: string, hasVariants: boolean) => {
    if (hasVariants) return router.push(`/product/${slug}`)
    mark(productId, true)
    try {
      const intent = await createBuyNowIntent({ productId, qty: 1 })
      router.push({ pathname: '/checkout/review', params: { intent } })
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Failed to start checkout')
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
        toast.success('Moved to cart')
      } catch {
        toast.success('Item added to cart!')
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Failed to add to cart')
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
            <View className="mb-4 flex-row gap-2">
              {[50, 82, 106].map((w, i) => (
                <Skeleton key={i} width={w} height={32} rounded="rounded-full" />
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

  const refreshControl = (
    <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.accent500} colors={[t.accent500]} progressBackgroundColor={t.surfaceElevated} />
  )

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

  const renderItem = ({ item }: { item: WishlistRow }) => {
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
      <Card padded={false}>
        {/* Repeats the name link below, so screen readers skip it. */}
        <Pressable
          onPress={open}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          className="relative mx-3 mt-3 overflow-hidden rounded-xl border border-border-default"
          style={{ aspectRatio: 5 / 3 }}
        >
          {image ? (
            <>
              <Image
                source={{ uri: image.thumbnail_url }}
                style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.6, transform: [{ scale: 1.1 }] }}
                contentFit="cover"
                blurRadius={24}
                recyclingKey={image.thumbnail_url}
              />
              <Image source={{ uri: image.thumbnail_url }} recyclingKey={image.thumbnail_url} style={{ width: '100%', height: '100%' }} contentFit="contain" />
            </>
          ) : (
            <View className="flex-1 items-center justify-center">
              <ImageIcon size={80} color={t.foregroundMuted} strokeWidth={1} />
            </View>
          )}
          {mrpDiscount > 0 && <Pill label={`${mrpDiscount}% off`} tone="accent" className="absolute right-3 top-3" />}
          {(badges.backInStock || badges.priceDrop) && (
            <View className="absolute left-3 top-3 items-start gap-1">
              {badges.backInStock && <Pill label="Back in stock" tone="success" />}
              {badges.priceDrop && <Pill label={`Price dropped ${badges.priceDrop.pct}%`} tone="danger" />}
            </View>
          )}
        </Pressable>

        <View className="p-4">
          <IconButton
            icon={X}
            size="xs"
            color={status.heart}
            label={`Remove ${p.name} from wishlist`}
            onPress={() => handleRemove(item.product_id)}
            className="mb-1 self-end"
          />

          <Pressable
            onPress={open}
            accessibilityRole="link"
            // The pills sit on the image, which screen readers skip.
            accessibilityLabel={[p.name, mrpDiscount > 0 && `${mrpDiscount}% off`, badges.backInStock && 'Back in stock', badges.priceDrop && `Price dropped ${badges.priceDrop.pct}%`]
              .filter(Boolean)
              .join(', ')}
          >
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
          <Text className="mb-3 text-[11px] text-foreground-muted">Inclusive of all taxes</Text>

          <View className="mb-3 flex-row items-center justify-between">
            <Text className={`text-xs font-medium ${inStock ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {inStock ? 'In Stock' : 'Out of Stock'}
            </Text>
          </View>

          <Button
            label={isDigital ? 'Buy Now' : 'Add to Cart'}
            icon={ShoppingCart}
            size="md"
            loading={adding}
            loadingLabel={isDigital ? 'Processing...' : 'Adding...'}
            disabled={!inStock}
            onPress={() => (isDigital ? handleBuyNow(item.product_id, p.slug, hasVariants) : handleAddToCart(item.product_id))}
          />
        </View>
      </Card>
    )
  }

  return (
    <Screen header={<TopNav />} mode="none">
      <List
        data={filtered}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        extraData={busy}
        gap={16}
        refreshing={isRefetching}
        onRefresh={refetch}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 0 }}
        ListHeaderComponent={
          <View className="-mx-4 mb-4">
            <AccountMobileHeader />
            <ChipGroup className="mx-4 mt-4">
              {FILTERS.map(([val, label]) => (
                <Chip key={val} label={label} size="sm" selected={filter === val} onPress={() => setFilter(val)} />
              ))}
            </ChipGroup>
          </View>
        }
        ListFooterComponent={
          <View className="pb-4">
            <FeaturedProducts />
          </View>
        }
      />
    </Screen>
  )
}
