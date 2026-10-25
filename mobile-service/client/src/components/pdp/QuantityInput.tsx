import { Pressable, TextInput, View } from 'react-native'
import { Text } from '../../ui'
import { Glyph, P } from './Glyph'
import { fmtQty, unitText } from './pdp'
import { unitCapError, type PickerQtyCap } from './useProductPurchase'
import { useTokens } from '../../theme'

// Mirror of controller-service components/shared/QuantityInput.tsx + InCartQtyHint.tsx.
// Count units get the round stepper; length/weight/volume/area use the decimal stepper (the web's
// tape ruler and W×H area inputs are mouse/scroll widgets with no touch-native equivalent here).

interface Props {
  dimension: string
  quantity: number
  quantityRaw: string
  unitLabel: string | null
  effectiveStock: number
  qtyStep: number
  qtyMin: number
  qtyMax?: number
  onChange: (qty: number, raw: string) => void
}

function QtyHint({ qtyMin, qtyMax, qtyStep, unitLabel, defaultStep }: { qtyMin: number; qtyMax?: number; qtyStep: number; unitLabel: string | null; defaultStep: number }) {
  const parts: string[] = []
  if (qtyMin > 0) parts.push(`Min: ${fmtQty(qtyMin)}`)
  if (qtyMax != null) parts.push(`Max: ${fmtQty(qtyMax)}`)
  if (qtyStep !== defaultStep) parts.push(`Step: ${fmtQty(qtyStep)}`)
  if (parts.length === 0) return null
  return (
    <Text className="mt-1 text-xs text-foreground-muted">
      {parts.join(' · ')}
      {unitLabel ? ` ${unitLabel}` : ''}
    </Text>
  )
}

function RoundStep({ onPress, disabled, label, d }: { onPress: () => void; disabled: boolean; label: string; d: string }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      className={`h-9 w-9 items-center justify-center rounded-full border border-border-default bg-surface-secondary ${disabled ? 'opacity-40' : ''}`}
    >
      <Glyph d={d} size={16} className="text-foreground" />
    </Pressable>
  )
}

export default function QuantityInput(props: Props) {
  const { dimension, quantity, quantityRaw, unitLabel, effectiveStock, qtyStep, qtyMin, qtyMax, onChange } = props
  const t = useTokens()
  const ceiling = Math.min(effectiveStock, qtyMax ?? effectiveStock)
  const count = !(dimension === 'length' || dimension === 'weight' || dimension === 'volume' || dimension === 'area')

  const dec = () => {
    const next = count ? Math.max(qtyMin, quantity - 1) : Math.max(qtyMin, Math.round((quantity - qtyStep) * 1000) / 1000)
    onChange(next, count || next % 1 === 0 ? String(next) : fmtQty(next))
  }
  const inc = () => {
    const next = count ? Math.min(ceiling, quantity + 1) : Math.min(ceiling, Math.round((quantity + qtyStep) * 1000) / 1000)
    onChange(next, count || next % 1 === 0 ? String(next) : fmtQty(next))
  }
  const onText = (raw: string) => {
    const v = count ? parseInt(raw, 10) : parseFloat(raw)
    onChange(isNaN(v) ? quantity : Math.min(ceiling, Math.max(qtyMin, v)), raw)
  }
  const onBlur = () => {
    if (count) {
      const v = parseInt(quantityRaw, 10)
      const clamped = isNaN(v) || v < qtyMin ? qtyMin : Math.min(ceiling, v)
      onChange(clamped, String(clamped))
      return
    }
    const v = parseFloat(quantityRaw)
    let clamped = isNaN(v) || v < qtyMin ? qtyMin : Math.min(ceiling, v)
    clamped = Math.round((clamped - qtyMin) / qtyStep) * qtyStep + qtyMin
    clamped = Math.max(qtyMin, Math.min(ceiling, parseFloat(clamped.toFixed(6))))
    onChange(clamped, fmtQty(clamped))
  }

  return (
    <View className="gap-1">
      <View className="flex-row items-center gap-2">
        <View className="flex-row items-center gap-1.5">
          <RoundStep label="Decrease quantity" disabled={quantity <= qtyMin} onPress={dec} d={P.minus} />
          <TextInput
            value={quantityRaw}
            onChangeText={onText}
            onEndEditing={onBlur}
            keyboardType={count ? 'number-pad' : 'decimal-pad'}
            selectTextOnFocus
            placeholderTextColor={t.foregroundMuted}
            className={`${count ? 'w-12' : 'w-16'} min-h-[36px] text-center text-base font-semibold text-foreground`}
            style={{ fontVariant: ['tabular-nums'] }}
          />
          <RoundStep label="Increase quantity" disabled={quantity >= ceiling} onPress={inc} d={P.plus} />
        </View>
        {unitLabel ? (
          <Text className={`text-sm ${count ? 'text-foreground-muted' : 'text-foreground-secondary'}`}>{unitText(unitLabel)}</Text>
        ) : null}
      </View>
      <QtyHint qtyMin={qtyMin} qtyMax={qtyMax} qtyStep={qtyStep} unitLabel={unitLabel} defaultStep={count ? 1 : 0.001} />
    </View>
  )
}

/** "5 already in cart" / "Max quantity already in cart" under the picker. */
export function InCartQtyHint({ cap, unitLabel, adding }: { cap: PickerQtyCap; unitLabel?: string | null; adding?: number }) {
  const over = adding != null && cap.max != null && !cap.full ? unitCapError(cap.max + cap.inCart, cap.inCart, adding) : null
  if (over) return <Text className="text-xs font-medium text-amber-700 dark:text-amber-400">{over}</Text>
  if (cap.full) return <Text className="text-xs font-medium text-amber-700 dark:text-amber-400">Max quantity already in cart</Text>
  if (cap.inCart <= 0) return null
  return (
    <Text className="text-xs text-foreground-muted">
      {String(Number(cap.inCart.toFixed(6)))}
      {unitLabel ? ` ${unitLabel}` : ''} already in cart
    </Text>
  )
}
