import { useEffect, useState, type RefObject } from 'react'
import { Linking, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Check, CircleCheck, CircleX, FileText, ShoppingCart, Zap } from 'lucide-react-native'
import { Badge, Button, Chip, ChipGroup, ListRow, ModalSheet, Text } from '../../ui'
import QuantityInput, { InCartQtyHint } from './QuantityInput'
import { OptionChips } from './OptionChips'
import { MODE_LABELS, type ProductPurchase } from './useProductPurchase'
import { unitText } from './pdp'
import { listAddresses } from '../../api/addresses'
import { getEddForPin } from '../../api/pdp'
import { resolveEdd } from '../../lib/edd'
import { inr, shortDate } from '../../lib/format'
import { SITE_URL } from '../../lib/links'
import { useAuthStore } from '../../stores/authStore'
import { status, useTokens } from '../../theme'
import type { Address } from '../../types'

// Mirror of controller-service components/visitor/ProductActions.tsx at the mobile breakpoint.

export default function ProductActions({
  p,
  digital,
  alreadyOwned,
  vaultUrl,
  isCodAllowed,
  handlingDays,
  extraDeliveryDays,
  gstEnabled,
  launchDate,
  optionsRef,
  buyRef,
  onRequestQuote,
}: {
  p: ProductPurchase
  digital: boolean
  alreadyOwned: boolean
  vaultUrl: string | null
  isCodAllowed: boolean
  handlingDays: number
  extraDeliveryDays: number
  gstEnabled: boolean
  launchDate: string | null
  optionsRef: RefObject<View | null>
  buyRef: RefObject<View | null>
  /** An approved business account can ask for a quote instead of buying. */
  onRequestQuote?: () => void
}) {
  const router = useRouter()
  const t = useTokens()
  const user = useAuthStore(s => s.user)
  const [showAllVariants, setShowAllVariants] = useState(false)
  const [showAllSubs, setShowAllSubs] = useState(false)
  const [edd, setEdd] = useState<string | null>(null)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [selectedPin, setSelectedPin] = useState<string | null>(null)
  const [showAddressPicker, setShowAddressPicker] = useState(false)

  useEffect(() => {
    let live = true
    if (!user) {
      resolveEdd(false, handlingDays, extraDeliveryDays).then(v => {
        if (live && v) setEdd(v)
      })
      return () => {
        live = false
      }
    }
    listAddresses()
      .then(list => {
        if (!live) return null
        setAddresses(list)
        setSelectedPin(list.find(a => a.is_default)?.postal_code ?? list[0]?.postal_code ?? null)
        return resolveEdd(true, handlingDays, extraDeliveryDays)
      })
      .then(v => {
        if (live && v) setEdd(v)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [user])

  const pickAddress = (pin: string) => {
    setSelectedPin(pin)
    setShowAddressPicker(false)
    getEddForPin(pin, handlingDays, extraDeliveryDays).then(v => {
      if (v) setEdd(v)
    })
  }

  const variantLabel = p.variants.find(v => v.variant_type)?.variant_type || p.variantType || 'Variant'
  const selectLabel = p.hasMultipleModes
    ? p.selectedMode === 'unit'
      ? `Select ${variantLabel}`
      : `Select ${p.selectedMode === 'weight' ? 'Weight' : 'Length'}`
    : `Select ${variantLabel}`
  const subs = p.selectedVariant?.sub_variants ?? []
  const unitLabel = p.effectiveUnitLabel
  const disabledBase = !p.isActive || p.effectiveStock === 0 || p.isPreLaunch || p.isDiscontinued

  return (
    <View className="gap-4">
      {p.hasVariants ? (
        <View ref={optionsRef} collapsable={false} className="gap-3">
          {p.hasMultipleModes ? (
            <View>
              <Text className="mb-2 text-sm font-medium text-foreground-secondary">Buy by</Text>
              <ChipGroup>
                {p.pricingTypes.map(pt => (
                  <Chip key={pt} label={MODE_LABELS[pt] || pt} selected={p.selectedMode === pt} onPress={() => p.setSelectedMode(pt)} />
                ))}
              </ChipGroup>
            </View>
          ) : null}

          <View>
            <Text className="mb-2 text-sm font-medium text-foreground-secondary">{selectLabel}</Text>
            <OptionChips
              options={p.modeVariants.map(v => ({ id: v.id, name: v.variant_name, stock_status: v.stock_status }))}
              selectedId={p.selectedVariantId}
              onSelect={p.setSelectedVariantId}
              showAll={showAllVariants}
              onToggle={() => setShowAllVariants(s => !s)}
            />
          </View>

          {subs.length > 0 ? (
            <View>
              <Text className="mb-2 text-sm font-medium text-foreground-secondary">Select {p.subVariantType || 'Sub-Variant'}</Text>
              <OptionChips
                options={subs.map(s => ({ id: s.id, name: s.sub_variant_name, stock_status: s.stock_status }))}
                selectedId={p.selectedSubVariantId}
                onSelect={p.setSelectedSubVariantId}
                showAll={showAllSubs}
                onToggle={() => setShowAllSubs(s => !s)}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {/* Price block: big price per base unit, selling-unit line, total, savings, tax note. */}
      <View className="rounded-field bg-surface p-5">
        <View className="mb-1 flex-row flex-wrap items-baseline gap-2">
          <Text className="text-4xl font-bold text-primary-600 dark:text-primary-400">Rs. {inr(p.effectivePrice)}</Text>
          {p.showPerUnit ? <Text className="text-sm text-foreground-secondary">/ {unitText(p.perUnitLabel)}</Text> : null}
          {p.effectiveMrp && p.effectiveMrp > p.effectivePrice ? (
            <Text className="text-xl text-foreground-muted line-through">Rs. {inr(p.effectiveMrp)}</Text>
          ) : null}
        </View>
        {p.showPerBasePrice ? (
          <Text className="mb-1 text-base font-semibold text-foreground">
            Rs. {inr(p.effectivePrice * p.unitFactor)} / {unitText(unitLabel)}
            <Text className="text-xs font-normal text-foreground-muted">
              {'  '}(1 {unitText(unitLabel)} = {p.unitFactor} {unitText(p.baseUnitLabel ?? unitLabel)} × Rs. {inr(p.effectivePrice)})
            </Text>
          </Text>
        ) : null}
        <View className="mb-2 flex-row flex-wrap items-center gap-2">
          <Text className="text-sm text-foreground-secondary">
            Total ({p.quantity} {unitText(unitLabel)}):
          </Text>
          <Text className="text-base font-semibold text-foreground">Rs. {inr(p.effectivePrice * p.unitFactor * p.quantity)}</Text>
        </View>
        {p.mrpDiscount > 0 ? (
          <View className="mb-2 flex-row flex-wrap items-center gap-2">
            {p.businessPct > 0 ? <Badge label={`Business ${p.businessPct}% extra off`} tone="brand" /> : null}
            <Badge label={`${p.mrpDiscount}% off`} tone="accent" />
            <Text className="text-sm text-foreground-secondary">
              You save Rs. {inr((p.effectiveMrp! - p.effectivePrice) * p.unitFactor * p.quantity)}
            </Text>
          </View>
        ) : null}
        {gstEnabled ? (
          <Text className="text-xs text-foreground-muted">
            Inclusive of all taxes{p.gstPercentage ? ` (${p.gstPercentage}% GST)` : ''}
          </Text>
        ) : null}
      </View>

      <View>
        <View className="mb-2 flex-row items-center justify-between gap-4">
          <Text className="text-sm font-medium text-foreground-secondary">
            Quantity{unitLabel && p.effectiveUnitKey !== 'unit' ? ` (${unitText(unitLabel)})` : ''}
          </Text>
          <View className="shrink items-end">
            {p.effectiveStock > 0 ? (
              <View className="flex-row flex-wrap items-center justify-end gap-2">
                <View className="flex-row items-center gap-1.5">
                  <CircleCheck size={20} color={status.success} />
                  <Text className="font-semibold text-green-700 dark:text-green-400">In Stock</Text>
                </View>
                {isCodAllowed ? <Badge label="COD" tone="warning" size="sm" /> : null}
              </View>
            ) : (
              <View className="flex-row items-center justify-end gap-2">
                <CircleX size={20} color={status.danger} />
                <Text className="font-semibold text-red-700 dark:text-red-400">Out of Stock</Text>
              </View>
            )}
            {edd && p.effectiveStock > 0 ? (
              <Text className="text-right text-xs text-foreground-secondary">
                Deliver by <Text className="font-medium text-foreground">{shortDate(edd)}</Text>
                {user && selectedPin ? (
                  <>
                    {' · '}
                    <Text className="font-medium">{selectedPin}</Text>
                    {addresses.length > 0 ? (
                      <Text onPress={() => setShowAddressPicker(true)} accessibilityRole="link" className="font-semibold text-accent-600 dark:text-accent-400">
                        {' '}Change
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </Text>
            ) : null}
          </View>
        </View>

        <ModalSheet open={showAddressPicker} onClose={() => setShowAddressPicker(false)} title="Deliver to">
          <View className="-mx-5">
            {addresses.map((a, i) => (
              <ListRow
                key={a.id ?? i}
                title={a.full_name}
                subtitle={`${a.city}, ${a.state} – ${a.postal_code}`}
                trailing={a.postal_code === selectedPin ? <Check size={18} strokeWidth={2.5} color={t.accent500} /> : null}
                chevron={false}
                onPress={() => pickAddress(a.postal_code)}
              />
            ))}
          </View>
        </ModalSheet>

        {!digital ? (
          <View className="gap-1">
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
      </View>

      {p.isPreLaunch && launchDate ? (
        <View className="rounded-field bg-amber-50 px-4 py-3 dark:bg-amber-900/20">
          <Text className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Coming Soon — Available from{' '}
            {new Date(launchDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
        </View>
      ) : null}
      {p.isDiscontinued ? (
        <View className="rounded-field bg-surface-secondary px-4 py-3">
          <Text className="text-sm font-medium text-foreground-muted">This product has been discontinued</Text>
        </View>
      ) : null}

      <View ref={buyRef} collapsable={false} className="gap-3">
        {alreadyOwned ? (
          <Button label="Open in vault" onPress={() => Linking.openURL(vaultUrl || `${SITE_URL}/api/vault/handoff`)} />
        ) : (
          <>
            <Button
              label="Buy Now"
              icon={Zap}
              loading={p.isBuyingNow}
              loadingLabel="Processing..."
              disabled={disabledBase}
              haptics
              onPress={p.handleBuyNow}
            />
            {!digital ? (
              <Button
                label={p.cartCap.full ? 'Max quantity already in cart' : 'Add to Cart'}
                icon={ShoppingCart}
                variant="outline"
                loading={p.isAddingToCart}
                loadingLabel="Adding..."
                disabled={disabledBase || p.addBlocked}
                haptics
                onPress={p.handleAddToCart}
              />
            ) : null}
            {p.inCart && !digital ? <Button label="View cart" icon={ShoppingCart} variant="ghost" size="md" onPress={() => router.push('/(tabs)/cart')} /> : null}
            {onRequestQuote && !digital ? <Button label="Request a quote" icon={FileText} variant="outline" onPress={onRequestQuote} /> : null}
          </>
        )}
      </View>
    </View>
  )
}
