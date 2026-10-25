import { useState } from 'react'
import { Pressable, Share, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Image } from 'expo-image'
import { ChevronRight, Heart, Share2, X } from 'lucide-react-native'
import { getPdpProduct, getVaultOwned, type PdpProduct } from '../../api/pdp'
import { useProductPurchase, MODE_LABELS } from '../pdp/useProductPurchase'
import QuantityInput, { InCartQtyHint } from '../pdp/QuantityInput'
import { OptionChips } from '../pdp/OptionChips'
import { unitText } from '../pdp/pdp'
import { Badge, BottomSheet, Button, Chip, ChipGroup, IconButton, SheetFooter, Skeleton, Text, TextButton, haptic } from '../../ui'
import { useWishlistToggle } from '../../hooks/useWishlist'
import { useStoreConfig } from '../../hooks/useStoreConfig'
import { useAuthStore } from '../../stores/authStore'
import { useQuickAddStore } from '../../stores/quickAddStore'
import { inr } from '../../lib/format'
import { SITE_URL } from '../../lib/links'
import { status, useTokens } from '../../theme'
import type { CardProduct } from '../../types/home'

// The web's "+" popup (QuickAddPicker) as a sheet: options, quantity and one "Add item · ₹total" bar.
// One instance lives at the root (QuickAddSheetHost); cards open it through quickAddStore.

export function QuickAddSheetHost() {
  const seed = useQuickAddStore(s => s.seed)
  const close = useQuickAddStore(s => s.close)
  // The last product stays mounted while the sheet slides away.
  const [shown, setShown] = useState<CardProduct | null>(null)
  if (seed && seed !== shown) setShown(seed)
  return (
    <BottomSheet open={!!seed} onClose={close}>
      {shown ? <QuickAddContent seed={shown} /> : null}
    </BottomSheet>
  )
}

function QuickAddContent({ seed }: { seed: CardProduct }) {
  const { data: product, isError, refetch } = useQuery({
    queryKey: ['product', seed.slug],
    queryFn: () => getPdpProduct(seed.slug),
    enabled: !!seed.slug,
  })
  if (product) return <QuickAddBody key={product.id} product={product} seed={seed} />
  if (isError || !seed.slug) return <ErrorBody seed={seed} retry={seed.slug ? () => refetch() : undefined} />
  return <LoadingBody seed={seed} />
}

function ErrorBody({ seed, retry }: { seed: CardProduct; retry?: () => void }) {
  const router = useRouter()
  const close = useQuickAddStore(s => s.close)
  return (
    <View>
      <SheetFooter>
        <Button
          label="View product"
          onPress={() => {
            close()
            router.push(`/product/${seed.slug}`)
          }}
        />
      </SheetFooter>
      <Header name={seed.name} brand={seed.brandName} image={seed.primaryImage?.thumbnail_url || seed.primaryImage?.image_url || null} productId={seed.id} slug={seed.slug} />
      <View className="mt-5 items-start gap-2">
        <Text className="text-sm text-foreground-secondary">Couldn’t load the options right now.</Text>
        {retry ? <TextButton label="Try again" onPress={retry} /> : null}
      </View>
    </View>
  )
}

// QuickAddBody's shape under the seed's header: price row, option chips, quantity, details link.
function LoadingBody({ seed }: { seed: CardProduct }) {
  return (
    <View className="gap-5">
      <SheetFooter>
        <Skeleton height={56} rounded="rounded-field" />
      </SheetFooter>
      <Header name={seed.name} brand={seed.brandName} image={seed.primaryImage?.thumbnail_url || seed.primaryImage?.image_url || null} productId={seed.id} slug={seed.slug} />
      <View className="flex-row items-center gap-2">
        <Skeleton height={28} width={110} />
        <Skeleton height={20} width={64} rounded="rounded-full" />
      </View>
      <View className="gap-2">
        <Skeleton height={14} width={110} rounded="rounded" />
        <View className="flex-row gap-2">
          {[72, 88, 64].map((w, i) => (
            <Skeleton key={i} height={38} width={w} rounded="rounded-full" />
          ))}
        </View>
      </View>
      <View className="gap-2">
        <Skeleton height={14} width={70} rounded="rounded" />
        <View className="flex-row items-center gap-2">
          <Skeleton width={128} height={44} rounded="rounded-full" />
        </View>
      </View>
      <Skeleton height={44} rounded="rounded-field" />
    </View>
  )
}

function Header({ name, brand, image, productId, slug }: { name: string; brand: string | null; image: string | null; productId: string; slug: string }) {
  const t = useTokens()
  const router = useRouter()
  const close = useQuickAddStore(s => s.close)
  const user = useAuthStore(s => s.user)
  const wishlist = useWishlistToggle(productId)
  // Signed out, the toggle opens sign-in; close first so the modal isn't under the sheet.
  const like = () => {
    if (!user) close()
    wishlist.toggle()
  }
  const share = async () => {
    const url = `${SITE_URL}/products/${slug}`
    try {
      await Share.share({ title: name, message: `Check out ${name}\n${url}`, url })
    } catch {}
  }
  return (
    <View className="flex-row items-start gap-3">
      <Pressable
        onPress={() => {
          close()
          router.push(`/product/${slug}`)
        }}
        accessibilityRole="imagebutton"
        accessibilityLabel={`View ${name}`}
        className="h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-field border border-border-default bg-surface"
      >
        {image ? <Image recyclingKey={image} source={{ uri: image }} style={{ width: 72, height: 72 }} contentFit="contain" transition={150} /> : null}
      </Pressable>
      <View className="flex-1">
        {brand ? <Text className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">{brand}</Text> : null}
        <Text numberOfLines={2} className="text-base font-bold leading-5 text-foreground">
          {name}
        </Text>
      </View>
      <View className="flex-row items-center gap-1.5">
        <IconButton
          icon={Heart}
          label={wishlist.inWishlist ? 'Remove from wishlist' : 'Add to wishlist'}
          variant="tinted"
          size="sm"
          filled={wishlist.inWishlist}
          color={wishlist.inWishlist ? status.heart : t.foregroundSecondary}
          disabled={wishlist.pending}
          onPress={like}
        />
        <IconButton icon={Share2} label="Share" variant="tinted" size="sm" color={t.foregroundSecondary} onPress={share} />
        <IconButton icon={X} label="Close" variant="tinted" size="sm" color={t.foregroundSecondary} onPress={close} />
      </View>
    </View>
  )
}

function QuickAddBody({ product, seed }: { product: PdpProduct; seed: CardProduct }) {
  const router = useRouter()
  const t = useTokens()
  const user = useAuthStore(s => s.user)
  const close = useQuickAddStore(s => s.close)
  const markAdded = useQuickAddStore(s => s.markAdded)
  const { gstEnabled, digitalProductsEnabled } = useStoreConfig().flags
  const digital = digitalProductsEnabled && !!product.is_digital
  const { data: vault } = useQuery({
    queryKey: ['pdp-vault-owned', product.id, user?.id],
    queryFn: () => getVaultOwned(product.id),
    enabled: digital && !!user,
  })
  const alreadyOwned = vault?.owned ?? !!product.owned_in_vault
  // Open on something buyable: the PDP defaults to the first variant even when it is sold out.
  const initialSku = product.product_variants?.find(v => v.stock_status !== 'Out of Stock')?.sku
  const p = useProductPurchase(product, { gstEnabled, digital, alreadyOwned, initialSku, trackView: false, onLeave: close })
  const [showAllVariants, setShowAllVariants] = useState(false)
  const [showAllSubs, setShowAllSubs] = useState(false)

  const image =
    p.selectedVariant?.variant_images?.[0]?.thumbnail_url ||
    product.product_images?.find(i => i.is_primary)?.thumbnail_url ||
    product.product_images?.[0]?.thumbnail_url ||
    seed.primaryImage?.image_url ||
    null
  const variantLabel = p.variants.find(v => v.variant_type)?.variant_type || p.variantType || 'Variant'
  const subs = p.selectedVariant?.sub_variants ?? []
  const unitLabel = p.effectiveUnitLabel
  const inStock = p.effectiveStock > 0
  const purchasable = p.isActive && !p.isPreLaunch && !p.isDiscontinued && inStock
  // Per selling unit, like the PDP and the web picker (a pack of 12 charges 12 × the base price).
  const total = p.effectivePrice * p.unitFactor * p.quantity

  const viewProduct = () => {
    close()
    router.push(`/product/${product.slug}`)
  }

  const addItem = async () => {
    if (!(await p.handleAddToCart())) return
    haptic.tap()
    markAdded(product.id)
    close()
  }

  const footer = !purchasable ? (
    <Button label={inStock ? 'View product' : 'Notify me when back'} onPress={viewProduct} variant="outline" />
  ) : digital ? (
    alreadyOwned ? (
      <Button label="Already in your vault" onPress={viewProduct} variant="outline" />
    ) : (
      <Button label={`Buy now · ₹${inr(total)}`} loading={p.isBuyingNow} loadingLabel="Please wait…" onPress={p.handleBuyNow} />
    )
  ) : (
    <Button
      label={p.addBlocked ? 'Max quantity in cart' : `Add item · ₹${inr(total)}`}
      loading={p.isAddingToCart}
      loadingLabel="Adding…"
      disabled={p.addBlocked}
      onPress={addItem}
    />
  )

  return (
    <View className="gap-5">
      <SheetFooter>{footer}</SheetFooter>
      <Header name={product.name} brand={product.brands?.name ?? seed.brandName} image={image} productId={product.id} slug={product.slug} />

      <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1">
        <Text className="text-2xl font-black text-foreground">₹{inr(p.effectivePrice)}</Text>
        {p.showPerUnit ? <Text className="text-sm text-foreground-secondary">/ {unitText(p.perUnitLabel)}</Text> : null}
        {p.effectiveMrp && p.effectiveMrp > p.effectivePrice ? (
          <>
            <Text className="text-sm text-foreground-muted line-through">₹{inr(p.effectiveMrp)}</Text>
            <Badge label={`${p.mrpDiscount}% off`} tone="accent" solid />
          </>
        ) : null}
        <Badge label={inStock ? 'In stock' : 'Out of stock'} tone={inStock ? 'accent' : 'neutral'} />
      </View>

      {p.hasVariants ? (
        <View className="gap-4">
          {p.hasMultipleModes ? (
            <View>
              <Text className="mb-2 text-sm font-semibold text-foreground">Buy by</Text>
              <ChipGroup>
                {p.pricingTypes.map(pt => (
                  <Chip key={pt} label={MODE_LABELS[pt] || pt} selected={p.selectedMode === pt} onPress={() => p.setSelectedMode(pt)} />
                ))}
              </ChipGroup>
            </View>
          ) : null}
          <View>
            <Text className="mb-2 text-sm font-semibold text-foreground">Select {variantLabel}</Text>
            <OptionChips
              options={p.modeVariants.map(v => ({ id: v.id, name: v.variant_name, stock_status: v.stock_status }))}
              selectedId={p.selectedVariantId}
              onSelect={p.setSelectedVariantId}
              showAll={showAllVariants}
              onToggle={() => setShowAllVariants(s => !s)}
              pill
            />
          </View>
          {subs.length > 0 ? (
            <View>
              <Text className="mb-2 text-sm font-semibold text-foreground">Select {p.subVariantType || 'Sub-Variant'}</Text>
              <OptionChips
                options={subs.map(s => ({ id: s.id, name: s.sub_variant_name, stock_status: s.stock_status }))}
                selectedId={p.selectedSubVariantId}
                onSelect={p.setSelectedSubVariantId}
                showAll={showAllSubs}
                onToggle={() => setShowAllSubs(s => !s)}
                pill
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {!digital && purchasable ? (
        <View className="gap-1">
          <Text className="text-sm font-semibold text-foreground">Quantity</Text>
          <QuantityInput
            dimension={p.dimension}
            quantity={p.quantity}
            quantityRaw={p.quantityRaw}
            unitLabel={unitLabel}
            effectiveStock={p.effectiveStock}
            qtyStep={p.qtyStep}
            qtyMin={p.qtyMin}
            qtyMax={p.qtyMax}
            onChange={p.setQty}
          />
          <InCartQtyHint cap={p.cartCap} unitLabel={unitLabel} adding={p.quantity} />
        </View>
      ) : null}

      <Pressable
        onPress={viewProduct}
        accessibilityRole="button"
        className="min-h-[48px] flex-row items-center justify-between rounded-field bg-surface-secondary px-4 py-3 active:bg-border-default"
      >
        <Text className="text-sm font-semibold text-foreground">View full details</Text>
        <ChevronRight size={18} color={t.foregroundMuted} />
      </Pressable>
    </View>
  )
}
