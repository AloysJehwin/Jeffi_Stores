import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react-native'
import { createRfq } from '../../api/business'
import { applyDiscount, useBusiness } from '../account/hooks'
import { errMsg } from '../account/ui'
import { fmtQty } from '../orders/shared'
import { inr } from '../../lib/format'
import { Button, Caption, cn, FieldError, Label, ModalSheet, SelectField, Stepper, Text, TextField, TintedIcon, toast } from '../../ui'
import { cleanDecimal, MAX_DISCOUNT_PCT, parseAmount, unitOptions } from './rfq'

// Port of controller-service components/business/RequestQuoteButton.tsx (the single-product sheet): quantity,
// unit, a target price or % discount (at most 30% under the current price), notes. The PDP owns the button.

export interface RequestQuoteProduct {
  id: string
  name: string
  variantId?: string
  subVariantId?: string
  /** The price per `unitLabel` the shopper sees (business price). */
  price: number
  unitLabel?: string
}

function Cell({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <View className="flex-1 items-center px-1">
      <Text className="mb-0.5 text-[9px] uppercase tracking-wide text-foreground-muted">{label}</Text>
      <Text className={cn('text-xs font-bold', className)}>{value}</Text>
    </View>
  )
}

/** Current / your target / discount, with the cap and saving notes. */
function PriceBreakdown({ current, target, unit }: { current: number; target: number | null; unit: string }) {
  const pct = target != null ? Math.round(((current - target) / current) * 100) : null
  const saving = target != null ? current - target : null
  const min = applyDiscount(current, MAX_DISCOUNT_PCT)
  const over = target != null && target < min
  return (
    <View className="overflow-hidden rounded-xl border border-accent-200 bg-accent-50/50 dark:border-accent-800 dark:bg-accent-900/20">
      <View className="flex-row py-2.5">
        <Cell label="Current" value={`₹${inr(current)}`} className="text-foreground" />
        <Cell
          label="Your Target"
          value={target != null ? `₹${inr(target)}` : '—'}
          className={over ? 'text-red-500' : target != null ? 'text-accent-600 dark:text-accent-400' : 'text-foreground-muted'}
        />
        <Cell
          label="Discount"
          value={pct != null && pct > 0 ? `${pct}% off` : '—'}
          className={over ? 'text-red-500' : pct != null && pct > 0 ? 'text-green-600 dark:text-green-400' : 'text-foreground-muted'}
        />
      </View>
      {over ? (
        <Text className="border-t border-red-200 bg-red-50 px-3 py-1.5 text-center text-[11px] font-medium text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
          Maximum discount is {MAX_DISCOUNT_PCT}% — minimum target price is ₹{inr(min)}
        </Text>
      ) : saving != null && saving > 0 ? (
        <Text className="border-t border-green-100 bg-green-50 px-3 py-1.5 text-center text-[11px] font-medium text-green-700 dark:border-green-900/40 dark:bg-green-900/20 dark:text-green-400">
          Potential saving of ₹{inr(saving)} per {unit || 'unit'} if approved
        </Text>
      ) : null}
      {target != null && target >= current && (
        <Text className="border-t border-amber-100 bg-amber-50 px-3 py-1.5 text-center text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-400">
          Target price is at or above current price
        </Text>
      )}
    </View>
  )
}

export function RequestQuoteSheet({ open, onClose, product }: { open: boolean; onClose: () => void; product: RequestQuoteProduct }) {
  const router = useRouter()
  const qc = useQueryClient()
  const { approved } = useBusiness()
  const baseUnit = product.unitLabel || 'Nos'
  const [qty, setQty] = useState('1')
  const [unit, setUnit] = useState(baseUnit)
  const [price, setPrice] = useState('')
  const [pct, setPct] = useState('')
  const [notes, setNotes] = useState('')
  const [overall, setOverall] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ id: string; rfq_number: string } | null>(null)

  // A fresh form each time it opens, as handleOpen does.
  useEffect(() => {
    if (!open) return
    setQty('1')
    setUnit(baseUnit)
    setPrice('')
    setPct('')
    setNotes('')
    setOverall('')
    setError('')
    setDone(null)
  }, [open, baseUnit])

  if (!approved) return null

  // The price is per the product's own unit; another unit has no price to compare against.
  const current = unit === baseUnit && product.price > 0 ? product.price : null
  const pctNum = parseAmount(pct)
  const target = parseAmount(price) ?? (current != null && pctNum != null && pctNum > 0 && pctNum < 100 ? applyDiscount(current, pctNum) : null)
  const overLimit = current != null && target != null && target < applyDiscount(current, MAX_DISCOUNT_PCT)
  const hasInput = !!(price || pct || notes)
  const q = parseFloat(qty)
  const quantity = Number.isFinite(q) && q > 0 ? q : 0
  const step = (d: number) => setQty(fmtQty(Math.max(d < 0 ? 1 : 0, Math.round((quantity + d) * 1000) / 1000)))

  const submit = async () => {
    setLoading(true)
    setError('')
    try {
      let requested_price = target
      // The 30% cap: clamp silently, the breakdown already warned.
      if (requested_price != null && current != null) requested_price = Math.max(requested_price, applyDiscount(current, MAX_DISCOUNT_PCT))
      const { rfq } = await createRfq({
        notes: overall.trim() || undefined,
        items: [
          {
            productId: product.id,
            variantId: product.variantId,
            subVariantId: product.subVariantId,
            description: product.name,
            quantity: quantity || 1,
            unit,
            requested_price,
            notes: notes.trim() || undefined,
          },
        ],
      })
      qc.invalidateQueries({ queryKey: ['rfqs'] })
      toast.success(`Quote request ${rfq.rfq_number} submitted! Our team will get back to you.`)
      setDone(rfq)
    } catch (err) {
      setError(errMsg(err, 'Failed to submit quote request'))
    } finally {
      setLoading(false)
    }
  }

  const close = () => !loading && onClose()

  if (done) {
    return (
      <ModalSheet
        open={open}
        onClose={onClose}
        footer={
          <View className="gap-3">
            <Button
              label="View quote"
              onPress={() => {
                onClose()
                router.push(`/account/quotes/${done.id}`)
              }}
            />
            <Button label="Done" variant="secondary" onPress={onClose} />
          </View>
        }
      >
        <View className="items-center gap-2 pb-2 pt-4">
          <TintedIcon icon={CheckCircle2} size={40} className="text-green-600 dark:text-green-400" />
          <Text className="text-center font-display text-xl font-extrabold text-foreground">Quote request submitted</Text>
          <Text className="text-center text-sm leading-5 text-foreground-secondary">
            <Text className="font-mono font-semibold text-foreground">{done.rfq_number}</Text> is with our team. We’ll get back to you with a quotation.
          </Text>
        </View>
      </ModalSheet>
    )
  }

  return (
    <ModalSheet
      open={open}
      onClose={close}
      dismissible={!loading}
      title="Request a Quote"
      subtitle={product.name}
      footer={
        <View className="gap-2">
          {overLimit && (
            <Text className="text-center text-xs text-red-500 dark:text-red-400">
              Target price exceeds the {MAX_DISCOUNT_PCT}% discount limit — please adjust before submitting.
            </Text>
          )}
          <FieldError message={error} className="text-center" />
          <View className="flex-row gap-3">
            <Button label="Cancel" variant="outline" className="flex-1" disabled={loading} onPress={close} />
            <Button label="Submit Quote" loadingLabel="Submitting…" className="flex-1" loading={loading} disabled={!hasInput || overLimit} onPress={submit} />
          </View>
        </View>
      }
    >
      <View className="gap-4 pb-2">
        {product.price > 0 && (
          <View>
            <Caption className="uppercase tracking-wide">Current Price</Caption>
            <Text className="text-xl font-bold text-primary-600 dark:text-primary-400">
              ₹{inr(product.price)}
              {product.unitLabel ? <Text className="text-sm font-medium text-foreground-muted"> / {product.unitLabel}</Text> : null}
            </Text>
          </View>
        )}

        <View>
          <Label required>Quantity</Label>
          <View className="flex-row items-center gap-3">
            <Stepper
              value={qty}
              onChangeText={raw => setQty(cleanDecimal(raw))}
              onEndEditing={() => setQty(fmtQty(quantity || 1))}
              onDecrement={() => step(-1)}
              onIncrement={() => step(1)}
              canDecrement={quantity > 1}
              decimal
              width={64}
              itemName={product.name}
            />
            <SelectField
              className="flex-1"
              value={unit}
              options={unitOptions(baseUnit)}
              onChange={u => {
                setUnit(u)
                if (u !== baseUnit) setPct('')
              }}
              sheetTitle="Unit"
            />
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-[13px] font-semibold text-foreground-secondary">
            Target Price <Text className="font-normal text-foreground-muted">— optional, enter one</Text>
          </Text>
          <View className="flex-row gap-3">
            <TextField
              containerClassName="flex-1"
              label={`₹ per ${unit || 'unit'}`}
              value={price}
              onChangeText={raw => {
                const v = cleanDecimal(raw)
                setPrice(v)
                if (v) setPct('')
              }}
              keyboardType="decimal-pad"
              prefix="₹"
              placeholder={current ? `e.g. ${inr(current * 0.9)}` : 'e.g. 350.00'}
            />
            <TextField
              containerClassName="w-32"
              label="% discount"
              value={pct}
              onChangeText={raw => {
                const v = cleanDecimal(raw)
                // Keep what's typed (e.g. "10.") unless it passes the cap.
                setPct(v && parseFloat(v) > MAX_DISCOUNT_PCT ? String(MAX_DISCOUNT_PCT) : v)
                if (v) setPrice('')
              }}
              keyboardType="decimal-pad"
              suffix="%"
              placeholder="e.g. 10"
              editable={current != null}
            />
          </View>
          {current != null && <PriceBreakdown current={current} target={target} unit={unit} />}
        </View>

        <TextField label="Item Notes — grade, brand, specs, etc." value={notes} onChangeText={setNotes} placeholder="e.g. Grade 10.9, stainless, specific tolerance…" />
        <TextField
          label="Additional Notes — delivery, urgency, project context"
          value={overall}
          onChangeText={setOverall}
          multiline
          placeholder="Any other requirements or context for this quote…"
        />
      </View>
    </ModalSheet>
  )
}

export default RequestQuoteSheet
