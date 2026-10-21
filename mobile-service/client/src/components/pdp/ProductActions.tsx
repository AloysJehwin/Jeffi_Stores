import { useEffect, useState, type RefObject } from 'react'
import { ActivityIndicator, Linking, Pressable, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Glyph, P } from './Glyph'
import QuantityInput, { InCartQtyHint } from './QuantityInput'
import { MODE_LABELS, type ProductPurchase } from './useProductPurchase'
import { unitText } from './pdp'
import { listAddresses } from '../../api/addresses'
import { getEddForPin } from '../../api/pdp'
import { resolveEdd } from '../../lib/edd'
import { inr, shortDate } from '../../lib/format'
import { SITE_URL } from '../../lib/links'
import { useAuthStore } from '../../stores/authStore'
import { status } from '../../theme'
import type { Address } from '../../types'

// Mirror of controller-service components/visitor/ProductActions.tsx at the mobile breakpoint.

const VARIANT_COLLAPSE_LIMIT = 12

interface Option {
  id: string
  name: string
  stock_status: string
}

function Chips({
  options,
  selectedId,
  onSelect,
  showAll,
  onToggle,
}: {
  options: Option[]
  selectedId: string | null
  onSelect: (id: string) => void
  showAll: boolean
  onToggle: () => void
}) {
  const selectedIndex = options.findIndex(o => o.id === selectedId)
  const mustExpand = !showAll && selectedIndex >= VARIANT_COLLAPSE_LIMIT
  const collapsed = !showAll && !mustExpand && options.length > VARIANT_COLLAPSE_LIMIT
  const visible = collapsed ? options.slice(0, VARIANT_COLLAPSE_LIMIT) : options
  return (
    <>
      <View className="flex-row flex-wrap gap-2">
        {visible.map(o => {
          const selected = o.id === selectedId
          const oos = o.stock_status === 'Out of Stock'
          return (
            <Pressable
              key={o.id}
              onPress={() => onSelect(o.id)}
              className={`rounded-lg border px-4 py-2 ${
                selected
                  ? 'border-accent-500 bg-accent-500'
                  : !oos
                    ? 'border-border-secondary bg-surface-elevated'
                    : 'border-dashed border-border-default bg-surface-secondary'
              }`}
            >
              <Text className={`text-sm font-medium ${selected ? 'text-white' : !oos ? 'text-foreground-secondary' : 'text-foreground-muted'}`}>
                {o.name}
                {oos ? ' (Out of Stock)' : ''}
              </Text>
            </Pressable>
          )
        })}
      </View>
      {options.length > VARIANT_COLLAPSE_LIMIT ? (
        <Pressable onPress={onToggle} className="mt-2 flex-row items-center gap-1 self-start">
          <Text className="text-sm font-medium text-accent-600 dark:text-accent-400">
            {showAll ? 'Show fewer' : `Show all ${options.length} options`}
          </Text>
          <View style={{ transform: [{ rotate: showAll ? '180deg' : '0deg' }] }}>
            <Glyph d={P.chevronDown} size={16} className="text-accent-600 dark:text-accent-400" />
          </View>
        </Pressable>
      ) : null}
    </>
  )
}

function PrimaryButton({
  onPress,
  disabled,
  busy,
  busyLabel,
  label,
  icon,
  className,
}: {
  onPress: () => void
  disabled: boolean
  busy: boolean
  busyLabel: string
  label: string
  icon: string
  className: string
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`w-full flex-row items-center justify-center gap-2 rounded-lg px-6 py-4 ${className} ${disabled ? 'opacity-50' : ''}`}
    >
      {busy ? <ActivityIndicator size="small" color={status.white} /> : <Glyph d={icon} size={20} className="text-white" />}
      <Text className="font-semibold text-white">{busy ? busyLabel : label}</Text>
    </Pressable>
  )
}

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
}) {
  const router = useRouter()
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
              <View className="flex-row flex-wrap gap-2">
                {p.pricingTypes.map(pt => (
                  <Pressable
                    key={pt}
                    onPress={() => p.setSelectedMode(pt)}
                    className={`rounded-lg border px-4 py-2 ${p.selectedMode === pt ? 'border-primary-600 bg-primary-600' : 'border-border-secondary bg-surface-elevated'}`}
                  >
                    <Text className={`text-sm font-semibold ${p.selectedMode === pt ? 'text-white' : 'text-foreground-secondary'}`}>
                      {MODE_LABELS[pt] || pt}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          <View>
            <Text className="mb-2 text-sm font-medium text-foreground-secondary">{selectLabel}</Text>
            <Chips
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
              <Chips
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
      <View className="rounded-lg bg-surface p-6">
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
            <View className="rounded-full bg-accent-100 px-3 py-1 dark:bg-accent-900/30">
              <Text className="text-sm font-semibold text-accent-700 dark:text-accent-400">{p.mrpDiscount}% off</Text>
            </View>
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
                  <Glyph d={P.checkCircleSolid} viewBox="0 0 20 20" solid evenOdd size={20} className="text-green-600 dark:text-green-400" />
                  <Text className="font-semibold text-green-700 dark:text-green-400">In Stock</Text>
                </View>
                {isCodAllowed ? (
                  <View className="rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 dark:border-amber-700 dark:bg-amber-900/20">
                    <Text className="text-[10px] font-semibold text-amber-700 dark:text-amber-400">COD</Text>
                  </View>
                ) : null}
              </View>
            ) : (
              <View className="flex-row items-center justify-end gap-2">
                <Glyph d={P.xCircleSolid} viewBox="0 0 20 20" solid evenOdd size={20} className="text-red-600 dark:text-red-400" />
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
                      <Text onPress={() => setShowAddressPicker(v => !v)} className="text-primary-600 underline dark:text-primary-400">
                        {' '}Change
                      </Text>
                    ) : null}
                  </>
                ) : null}
              </Text>
            ) : null}
          </View>
        </View>

        {showAddressPicker ? (
          <View className="mb-2 self-end rounded-lg border border-border-default bg-surface py-1 shadow-lg" style={{ width: 256 }}>
            {addresses.map((a, i) => (
              <Pressable key={a.id ?? i} onPress={() => pickAddress(a.postal_code)} className="px-3 py-2">
                <Text className="text-xs font-medium text-foreground">{a.full_name}</Text>
                <Text className="text-xs text-foreground-secondary">
                  {a.city}, {a.state} – {a.postal_code}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

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
        <View className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-900/20">
          <Text className="text-sm font-medium text-amber-600 dark:text-amber-400">
            Coming Soon — Available from{' '}
            {new Date(launchDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </Text>
        </View>
      ) : null}
      {p.isDiscontinued ? (
        <View className="rounded-lg bg-gray-100 px-3 py-2 dark:bg-gray-800">
          <Text className="text-sm font-medium text-gray-500 dark:text-gray-400">This product has been discontinued</Text>
        </View>
      ) : null}

      <View ref={buyRef} collapsable={false} className="gap-3">
        {alreadyOwned ? (
          <Pressable
            onPress={() => Linking.openURL(vaultUrl || `${SITE_URL}/api/vault/handoff`)}
            className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-primary-600 px-6 py-4"
          >
            <Text className="font-semibold text-white">Open in vault</Text>
          </Pressable>
        ) : (
          <>
            <PrimaryButton
              onPress={p.handleBuyNow}
              disabled={disabledBase || p.isBuyingNow}
              busy={p.isBuyingNow}
              busyLabel="Processing..."
              label="Buy Now"
              icon={P.bolt}
              className="bg-accent-500"
            />
            {!digital ? (
              <PrimaryButton
                onPress={p.handleAddToCart}
                disabled={disabledBase || p.isAddingToCart || p.addBlocked}
                busy={p.isAddingToCart}
                busyLabel="Adding..."
                label={p.cartCap.full ? 'Max quantity already in cart' : 'Add to Cart'}
                icon={P.cart}
                className="bg-primary-600"
              />
            ) : null}
            {p.inCart && !digital ? (
              <Pressable
                onPress={() => router.push('/(tabs)/cart')}
                className="w-full flex-row items-center justify-center gap-2 rounded-lg border border-primary-600 px-6 py-4"
              >
                <Glyph d={P.cart} size={20} className="text-primary-600 dark:text-primary-400" />
                <Text className="font-semibold text-primary-600 dark:text-primary-400">View cart</Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    </View>
  )
}
