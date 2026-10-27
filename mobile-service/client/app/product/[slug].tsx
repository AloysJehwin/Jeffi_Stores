import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { ScrollView, Share, View } from 'react-native'
import { CircleCheck, Heart, Share2 } from 'lucide-react-native'
import { useRouter, useLocalSearchParams } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { pushRecentlyViewed } from '../../src/stores/recentlyViewedStore'
import {
  getCategoryRows,
  getFreeDeliveryThreshold,
  getPdpProduct,
  getVaultOwned,
  notifyBackInStock,
  recordProductView,
  type PdpProduct,
} from '../../src/api/pdp'
import { useAuthStore } from '../../src/stores/authStore'
import { useCompareStore } from '../../src/stores/compareStore'
import { showToast } from '../../src/stores/toastStore'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { useWishlistToggle } from '../../src/hooks/useWishlist'
import { toCard } from '../../src/lib/card'
import { SITE_URL } from '../../src/lib/links'
import { status, useTokens } from '../../src/theme'
import {
  Badge, Button, Card, EmptyState, IconButton, KeyboardScroll, Screen, ScreenHeader, Skeleton, Text, TextField, Title, useBottomInset,
} from '../../src/ui'
import ProductCard from '../../src/components/product/ProductCard'
import { Grid } from '../../src/components/home/layout'
import { deduplicateByNameStem, nameStem, pickUnitPrice, round2 } from '../../src/components/pdp/pdp'
import { useProductPurchase } from '../../src/components/pdp/useProductPurchase'
import ProductImageGallery from '../../src/components/pdp/ProductImageGallery'
import ProductActions from '../../src/components/pdp/ProductActions'
import StickyAddToCartBar from '../../src/components/pdp/StickyAddToCartBar'
import CompareBar from '../../src/components/pdp/CompareBar'
import RazorpayOffers from '../../src/components/pdp/RazorpayOffers'
import { DeliveryInfo, PincodeChecker } from '../../src/components/pdp/DeliveryInfo'
import WarningBadges from '../../src/components/pdp/WarningBadges'
import ProductReviews, { ReviewSummaryLink, reviewSummary, useReviews } from '../../src/components/pdp/ProductReviews'
import FrequentlyBoughtTogether from '../../src/components/pdp/FrequentlyBoughtTogether'
import ProductSpecifications from '../../src/components/pdp/ProductSpecifications'
import FeaturesUseCases from '../../src/components/pdp/FeaturesUseCases'
import PdpCompareSection, { type CompareItem } from '../../src/components/pdp/PdpCompareSection'
import CustomersAlsoViewed from '../../src/components/pdp/CustomersAlsoViewed'
import PdpRecentlyViewed from '../../src/components/pdp/PdpRecentlyViewed'
import FeaturedForYou from '../../src/components/pdp/FeaturedForYou'
import { RequestQuoteSheet } from '../../src/components/business/RequestQuoteSheet'
import { useBusiness } from '../../src/components/account/hooks'

// Mirror of controller-service app/(storefront)/products/[slug]/page.tsx + ProductDetailClient at the mobile breakpoint.

export default function ProductDetailScreen() {
  const { slug, sku } = useLocalSearchParams<{ slug: string; sku?: string }>()
  const router = useRouter()
  const { data: product, isLoading } = useQuery({ queryKey: ['product', slug], queryFn: () => getPdpProduct(slug) })

  if (isLoading) return <Screen header={<ScreenHeader />} mode="none" loading skeleton={<PdpLoading />} />
  if (!product) {
    return (
      <Screen header={<ScreenHeader />} mode="none">
        <EmptyState fill title="Product Not Found" actionLabel="Browse products" onAction={() => router.push('/(tabs)/products')} />
      </Screen>
    )
  }
  return <ProductDetail key={product.id} product={product} initialSku={typeof sku === 'string' ? sku : undefined} />
}

/** The loaded page's shape: the details card (gallery, title, price block, buttons). */
function PdpLoading() {
  return (
    <View className="flex-1 overflow-hidden">
      <View className="px-4 pt-4">
        <Card padded={false} className="overflow-hidden">
          <View className="gap-4 p-4">
            <Skeleton aspectRatio={5 / 3} rounded="rounded-field" className="mb-4" />
            <View>
              <View className="mb-4 flex-row items-start justify-between gap-3">
                <View className="flex-1 gap-2">
                  <Skeleton height={24} />
                  <Skeleton height={24} width="60%" />
                </View>
                <View className="flex-row gap-1">
                  <Skeleton width={44} height={44} rounded="rounded-full" />
                  <Skeleton width={44} height={44} rounded="rounded-full" />
                </View>
              </View>
              <Skeleton height={14} width={170} rounded="rounded" className="mb-4" />
              <View className="gap-4">
                <View className="gap-3 rounded-field bg-surface p-5">
                  <Skeleton height={36} width={160} />
                  <Skeleton height={14} width="55%" rounded="rounded" />
                  <Skeleton height={12} width="40%" rounded="rounded" />
                </View>
                <View className="gap-2">
                  <View className="flex-row justify-between">
                    <Skeleton height={14} width={70} rounded="rounded" />
                    <Skeleton height={14} width={80} rounded="rounded" />
                  </View>
                  <Skeleton height={44} width={150} rounded="rounded-full" />
                </View>
                <View className="gap-3">
                  <Skeleton height={56} rounded="rounded-field" />
                  <Skeleton height={56} rounded="rounded-field" />
                </View>
              </View>
            </View>
          </View>
        </Card>
      </View>
    </View>
  )
}

/** The page's displayPrice / GST-rebased MRP, shared by the recently-viewed entry and the compare section. */
function cardPrice(p: PdpProduct, gstEnabled: boolean) {
  const price =
    p.has_variants && p.variant_min_price
      ? Number(p.variant_min_price)
      : Number(pickUnitPrice({ inclusive: p.base_price, exGst: p.price_ex_gst }, gstEnabled))
  const rawMrp = p.mrp ? Number(p.mrp) : p.variant_min_mrp ? Number(p.variant_min_mrp) : null
  const gstRate = Number(p.gst_percentage ?? 0)
  const mrp = !gstEnabled && rawMrp != null && gstRate > 0 ? round2(rawMrp / (1 + gstRate / 100)) : rawMrp
  return { price, mrp }
}

function primaryOf(p: PdpProduct) {
  return p.product_images?.find(i => i.is_primary) || p.product_images?.[0]
}

function compareItem(p: PdpProduct, gstEnabled: boolean): CompareItem {
  const img = primaryOf(p)
  const { price, mrp } = cardPrice(p, gstEnabled)
  return {
    ...p,
    id: p.id,
    name: p.name,
    slug: p.slug,
    price,
    mrp,
    image: img?.thumbnail_url || img?.image_url || null,
    brandName: p.brands?.name || null,
    categoryId: p.category_id || null,
    certifications: (p.certifications as string[] | null) ?? null,
  }
}

function ProductDetail({ product, initialSku }: { product: PdpProduct; initialSku?: string }) {
  const bottomInset = useBottomInset(80)
  const t = useTokens()
  const user = useAuthStore(s => s.user)
  const { gstEnabled, digitalProductsEnabled } = useStoreConfig().flags
  const digital = digitalProductsEnabled && !!product.is_digital
  const compareCount = useCompareStore(s => s.compareList.length)
  const wishlist = useWishlistToggle(product.id)

  const scrollRef = useRef<ScrollView>(null)
  const contentRef = useRef<View>(null)
  const optionsRef = useRef<View>(null)
  const buyRef = useRef<View>(null)
  const reviewsRef = useRef<View>(null)
  const [viewportH, setViewportH] = useState(0)
  const [buyBottom, setBuyBottom] = useState<number | null>(null)
  const [pastControls, setPastControls] = useState(false)

  const [notifyEmail, setNotifyEmail] = useState(user?.email ?? '')
  const [notifySubmitted, setNotifySubmitted] = useState(false)
  const [quoteOpen, setQuoteOpen] = useState(false)
  const business = useBusiness()

  const { data: vault } = useQuery({
    queryKey: ['pdp-vault-owned', product.id, user?.id],
    queryFn: () => getVaultOwned(product.id),
    enabled: digital && !!user,
  })
  const vaultOwned = vault?.owned ?? !!product.owned_in_vault

  const purchase = useProductPurchase(product, { gstEnabled, digital, alreadyOwned: vaultOwned, initialSku })
  const variantImages = useMemo(
    () => (purchase.selectedVariant?.variant_images?.length ? purchase.selectedVariant.variant_images : undefined),
    [purchase.selectedVariantId]
  )

  const { data: reviews } = useReviews(product.id)
  const summary = reviewSummary(reviews)
  const { data: freeThreshold } = useQuery({ queryKey: ['pdp-free-threshold'], queryFn: getFreeDeliveryThreshold, staleTime: 300_000 })
  const categorySlug = product.categories?.slug ?? null
  const { data: categoryRows = [] } = useQuery({
    queryKey: ['pdp-related', product.id, categorySlug],
    queryFn: () => getCategoryRows(categorySlug!, 20),
    enabled: !!categorySlug,
  })
  // page.tsx getRelatedProducts: same category, one per name stem, up to 4.
  const relatedProducts = useMemo(
    () => deduplicateByNameStem(categoryRows.filter(r => r.id !== product.id), nameStem(product.name)).slice(0, 4),
    [categoryRows, product.id, product.name]
  )

  useEffect(() => {
    if (user?.email) setNotifyEmail(user.email)
  }, [user])

  useEffect(() => {
    recordProductView(product.id)
  }, [product.id])

  // Same entry the web's TrackRecentlyViewed records, feeding the "Recently viewed" sections.
  useEffect(() => {
    const img = primaryOf(product)
    const { price, mrp } = cardPrice(product, gstEnabled)
    pushRecentlyViewed({
      id: product.id,
      name: product.name,
      slug: product.slug,
      price,
      mrp,
      brand: product.brands?.name ?? null,
      inStock: product.has_variants ? Number(product.variant_stock_total ?? 0) > 0 : product.stock_status !== 'Out of Stock',
      image: img?.thumbnail_url || img?.image_url || null,
      categoryId: product.category_id ?? null,
    })
  }, [product.id])

  const measure = (ref: RefObject<View | null>, cb: (y: number, h: number) => void) => {
    const node = ref.current
    const content = contentRef.current
    if (!node || !content) return
    node.measureLayout(content, (_x, y, _w, h) => cb(y, h), () => {})
  }
  const remeasure = () => measure(buyRef, (y, h) => setBuyBottom(y + h))
  const scrollToRef = (ref: RefObject<View | null>, center = false) =>
    measure(ref, (y, h) => scrollRef.current?.scrollTo({ y: Math.max(0, center ? y - (viewportH - h) / 2 : y - 8), animated: true }))

  const handleShare = async () => {
    const url = `${SITE_URL}/products/${product.slug}`
    try {
      await Share.share({ title: product.name, message: `Check out ${product.name}\n${url}`, url })
    } catch {}
  }

  const handleNotifyMe = async () => {
    const email = notifyEmail.trim()
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showToast('Enter a valid email address', 'error')
      return
    }
    try {
      await notifyBackInStock(product.id, email)
      setNotifySubmitted(true)
    } catch {
      showToast('Failed to save. Try again.', 'error')
    }
  }

  // Effective return / replacement policy: a brand opt-out wins, then category, then brand, then 7 days.
  const brand = product.brands
  const cat = product.categories
  const returnAllowed =
    brand?.return_allowed === false || cat?.return_allowed === false ? false : (brand?.return_allowed ?? cat?.return_allowed ?? true)
  const returnDays = returnAllowed
    ? brand?.return_allowed === false
      ? (brand.return_window_days ?? 7)
      : (cat?.return_window_days ?? brand?.return_window_days ?? 7)
    : 0
  const replacementAllowed =
    brand?.replacement_allowed === false || cat?.replacement_allowed === false
      ? false
      : (brand?.replacement_allowed ?? cat?.replacement_allowed ?? true)
  const replacementDays = replacementAllowed
    ? brand?.replacement_allowed === false
      ? (brand.replacement_window_days ?? 7)
      : (cat?.replacement_window_days ?? brand?.replacement_window_days ?? 7)
    : 0

  const primaryImage = primaryOf(product)
  const currentCard = toCard(product as any, gstEnabled)
  const handlingDays = Number(product.handling_days ?? 2)
  const extraDeliveryDays = Number(product.extra_delivery_days ?? 0)
  const discountPct = product.discount_pct != null ? Number(product.discount_pct) : null

  return (
    <Screen header={<ScreenHeader title={product.name} />} mode="none">
      <KeyboardScroll
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onLayout={e => setViewportH(e.nativeEvent.layout.height)}
        onContentSizeChange={remeasure}
        onScroll={e => setPastControls(buyBottom != null && e.nativeEvent.contentOffset.y >= buyBottom)}
      >
        <View ref={contentRef} collapsable={false}>
          <View className="px-4 pt-4" style={{ paddingBottom: bottomInset + (compareCount >= 2 ? 73 : 0) }}>
            {/* Product details card */}
            <Card padded={false} className="mb-6 overflow-hidden">
              <View className="gap-4 p-4">
                <ProductImageGallery
                  images={product.product_images || []}
                  productName={product.name}
                  variantImages={variantImages}
                  discountPct={discountPct}
                />

                <View>
                  <View className="mb-4 flex-row items-start justify-between gap-3">
                    <Title className="flex-1">{product.name}</Title>
                    <View className="shrink-0 flex-row items-center gap-1">
                      <IconButton
                        icon={Heart}
                        label={wishlist.inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
                        variant="tinted"
                        filled={wishlist.inWishlist}
                        color={wishlist.inWishlist ? status.heart : t.foreground}
                        disabled={wishlist.pending}
                        onPress={wishlist.toggle}
                      />
                      <IconButton icon={Share2} label="Share product" variant="tinted" color={t.foregroundSecondary} onPress={handleShare} />
                    </View>
                  </View>

                  <ReviewSummaryLink average={summary.average} total={summary.total} onPress={() => scrollToRef(reviewsRef)} />

                  <WarningBadges fragile={product.fragile} hazardous={product.hazardous} flammable={product.flammable} />

                  {/* Low-stock urgency, or notify-me when out of stock. */}
                  <View className="mb-4">
                    {product.stock_status === 'Low Stock' ? <Badge label="Only a few left — order soon" tone="warning" /> : null}
                    {product.stock_status === 'Out of Stock' ? (
                      notifySubmitted ? (
                        <View accessibilityLiveRegion="polite" className="flex-row items-center gap-2 rounded-field bg-green-50 px-4 py-3 dark:bg-green-900/20">
                          <CircleCheck size={16} color={status.success} />
                          <Text className="flex-1 text-sm text-green-700 dark:text-green-400">We'll email you when this is back in stock.</Text>
                        </View>
                      ) : (
                        <View className="flex-row items-start gap-2">
                          <TextField
                            value={notifyEmail}
                            onChangeText={setNotifyEmail}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoComplete="email"
                            placeholder="Enter your email"
                            accessibilityLabel="Email for back-in-stock alert"
                            containerClassName="flex-1"
                          />
                          <Button label="Notify Me" block={false} onPress={handleNotifyMe} />
                        </View>
                      )
                    ) : null}
                  </View>

                  <ProductActions
                    p={purchase}
                    digital={digital}
                    alreadyOwned={vaultOwned}
                    vaultUrl={vault?.url ?? null}
                    isCodAllowed={!!product.is_cod_allowed}
                    handlingDays={handlingDays}
                    extraDeliveryDays={extraDeliveryDays}
                    gstEnabled={gstEnabled}
                    launchDate={product.launch_date ?? null}
                    optionsRef={optionsRef}
                    buyRef={buyRef}
                    onRequestQuote={business.approved ? () => setQuoteOpen(true) : undefined}
                  />

                  <RazorpayOffers />
                </View>

                <View>
                  <DeliveryInfo
                    returnAllowed={returnAllowed}
                    returnDays={returnDays}
                    replacementAllowed={replacementAllowed}
                    replacementDays={replacementDays}
                    isCodAllowed={!!product.is_cod_allowed}
                    freeShippingThreshold={freeThreshold && freeThreshold > 0 ? freeThreshold : 500}
                  />
                  <PincodeChecker />
                </View>
              </View>
            </Card>

            <FrequentlyBoughtTogether
              current={currentCard}
              launchDate={product.launch_date}
              discontinueDate={product.discontinue_date}
              gstEnabled={gstEnabled}
              onChooseOptions={() => scrollToRef(optionsRef, true)}
            />

            <ProductSpecifications product={product} />

            <FeaturesUseCases product={product} />

            {relatedProducts.length >= 1 ? (
              <PdpCompareSection
                key={relatedProducts.map(r => r.id).join(',')}
                currentProduct={compareItem(product, gstEnabled)}
                relatedProducts={relatedProducts.slice(0, 2).map(r => compareItem(r, gstEnabled))}
              />
            ) : null}

            {product.description ? (
              <Card className="mb-6 p-5" padded={false}>
                <Text accessibilityRole="header" className="mb-4 font-display text-xl font-extrabold text-foreground">
                  Product Description
                </Text>
                <Text className="text-[15px] leading-[22px] text-foreground-secondary">{product.description}</Text>
              </Card>
            ) : null}

            <ProductReviews productId={product.id} productSlug={product.slug} sectionRef={reviewsRef} />

            <CustomersAlsoViewed productId={product.id} />

            <PdpRecentlyViewed excludeId={product.id} minItems={2} />

            <FeaturedForYou />

            {relatedProducts.length >= 4 ? (
              <View className="mt-8">
                <Title className="mb-4">Related Products</Title>
                <Grid cols={2} gap={16}>
                  {relatedProducts.map(r => (
                    <ProductCard key={r.id} product={toCard(r as any, gstEnabled)} handlingDays={Number(r.handling_days ?? 2)} />
                  ))}
                </Grid>
              </View>
            ) : null}
          </View>
        </View>
      </KeyboardScroll>

      <StickyAddToCartBar
        action={purchase.stickyAction}
        visible={pastControls}
        name={product.name}
        image={purchase.selectedVariant?.variant_images?.[0]?.thumbnail_url || primaryImage?.thumbnail_url || primaryImage?.image_url || null}
        price={purchase.effectivePrice}
        unitLabel={purchase.showPerUnit ? purchase.perUnitLabel : null}
        quantity={purchase.quantity}
        adding={digital ? purchase.isBuyingNow : purchase.isAddingToCart}
        onAdd={digital ? purchase.handleBuyNow : purchase.handleAddToCart}
        onChoose={() => scrollToRef(optionsRef, true)}
        buyNow={digital}
        aboveCompareBar={compareCount >= 2}
      />
      <CompareBar />
      {business.approved ? (
        <RequestQuoteSheet
          open={quoteOpen}
          onClose={() => setQuoteOpen(false)}
          product={{
            id: product.id,
            name: product.name,
            variantId: purchase.selectedVariantId ?? undefined,
            subVariantId: purchase.selectedSubVariantId ?? undefined,
            price: purchase.effectivePrice * purchase.unitFactor,
            unitLabel: purchase.effectiveUnitLabel ?? undefined,
          }}
        />
      ) : null}
    </Screen>
  )
}
