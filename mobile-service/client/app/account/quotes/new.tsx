import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react-native'
import { createRfq, type NewRfqItem } from '../../../src/api/business'
import { errMsg } from '../../../src/components/account/ui'
import { takeQuotePrefill } from '../../../src/components/business/quotePrefill'
import { cleanDecimal, MAX_DISCOUNT_PCT, parseAmount, unitOptions, useRequireBusiness } from '../../../src/components/business/rfq'
import { fmtQty } from '../../../src/components/orders/shared'
import { Button, Card, Label, Notice, Overline, Screen, SelectField, Stepper, Text, TextButton, TextField, toast } from '../../../src/ui'

// Mirror of controller-service app/(business)/business/quotes/new/page.tsx; lines handed over by the cart
// (quotePrefill) arrive filled in and keep their product links.

interface Line {
  key: number
  productId?: string
  variantId?: string
  subVariantId?: string
  description: string
  qty: string
  unit: string
  price: string
  notes: string
}

let seq = 0
const emptyLine = (): Line => ({ key: ++seq, description: '', qty: '1', unit: 'Nos', price: '', notes: '' })
const fromPrefill = (i: NewRfqItem): Line => ({
  key: ++seq,
  productId: i.productId,
  variantId: i.variantId,
  subVariantId: i.subVariantId,
  description: i.description,
  qty: fmtQty(i.quantity || 1),
  unit: i.unit || 'Nos',
  price: i.requested_price != null ? String(i.requested_price) : '',
  notes: i.notes ?? '',
})
const qtyOf = (raw: string) => {
  const v = parseFloat(raw)
  return Number.isFinite(v) && v > 0 ? v : 0
}

function LineCard({ line, index, removable, onChange, onRemove }: { line: Line; index: number; removable: boolean; onChange: (patch: Partial<Line>) => void; onRemove: () => void }) {
  const q = qtyOf(line.qty)
  const step = (d: number) => onChange({ qty: fmtQty(Math.max(d < 0 ? 1 : 0, Math.round((q + d) * 1000) / 1000)) })
  return (
    <Card className="gap-4">
      <View className="flex-row items-center justify-between">
        <Overline>Item {index + 1}</Overline>
        {removable && <TextButton label="Remove" tone="danger" onPress={onRemove} />}
      </View>
      <TextField label="Description" required value={line.description} onChangeText={description => onChange({ description })} placeholder="Product name or description" />
      <View>
        <Label required>Quantity</Label>
        <View className="flex-row items-center gap-3">
          <Stepper
            value={line.qty}
            onChangeText={raw => onChange({ qty: cleanDecimal(raw) })}
            onEndEditing={() => onChange({ qty: fmtQty(q || 1) })}
            onDecrement={() => step(-1)}
            onIncrement={() => step(1)}
            canDecrement={q > 1}
            decimal
            width={64}
            itemName={line.description || `item ${index + 1}`}
          />
          <SelectField className="flex-1" value={line.unit} options={unitOptions(line.unit)} onChange={unit => onChange({ unit })} sheetTitle="Unit" />
        </View>
      </View>
      <TextField
        label="Target Price (₹, optional)"
        value={line.price}
        onChangeText={raw => onChange({ price: cleanDecimal(raw) })}
        keyboardType="decimal-pad"
        prefix="₹"
        placeholder="Your target price per unit"
        helper={`Maximum discount allowed: ${MAX_DISCOUNT_PCT}% off the listed price`}
      />
      <TextField label="Notes (optional)" value={line.notes} onChangeText={notes => onChange({ notes })} placeholder="Specifications, grade, brand preference…" />
    </Card>
  )
}

export default function NewQuoteScreen() {
  const router = useRouter()
  const qc = useQueryClient()
  const { ready } = useRequireBusiness()
  const [lines, setLines] = useState<Line[]>(() => [emptyLine()])
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // The cart's lines, once (a second visit starts empty).
  useEffect(() => {
    const items = takeQuotePrefill()
    if (items?.length) setLines(items.map(fromPrefill))
  }, [])

  const update = (key: number, patch: Partial<Line>) => setLines(prev => prev.map(l => (l.key === key ? { ...l, ...patch } : l)))

  const submit = async () => {
    const valid = lines.filter(l => l.description.trim())
    if (valid.length === 0) return setError('Add at least one item with a description.')
    setError('')
    setSubmitting(true)
    try {
      const { rfq } = await createRfq({
        notes,
        items: valid.map(l => ({
          productId: l.productId,
          variantId: l.variantId,
          subVariantId: l.subVariantId,
          description: l.description.trim(),
          quantity: qtyOf(l.qty) || 1,
          unit: l.unit,
          requested_price: parseAmount(l.price),
          notes: l.notes.trim() || undefined,
        })),
      })
      qc.invalidateQueries({ queryKey: ['rfqs'] })
      toast.success(`Quote request ${rfq.rfq_number} submitted! Our team will get back to you.`)
      router.replace(`/account/quotes/${rfq.id}`)
    } catch (err) {
      setError(errMsg(err, 'Failed to submit RFQ'))
      setSubmitting(false)
    }
  }

  return (
    <Screen
      title="Submit Quote Request"
      mode="keyboard"
      loading={!ready}
      footer={
        <View className="gap-3">
          {!!error && <Notice tone="danger">{error}</Notice>}
          <View className="flex-row gap-3">
            <Button label="Cancel" variant="outline" className="flex-1" disabled={submitting} onPress={() => router.back()} />
            <Button label="Submit RFQ" loadingLabel="Submitting…" className="flex-1" loading={submitting} onPress={submit} />
          </View>
        </View>
      }
    >
      <View className="gap-4">
        <View className="flex-row items-center justify-between">
          <Text className="font-display text-lg font-extrabold text-foreground">Items</Text>
          <Button label="Add Item" icon={Plus} variant="ghost" size="sm" block={false} onPress={() => setLines(prev => [...prev, emptyLine()])} />
        </View>
        {lines.map((l, i) => (
          <LineCard key={l.key} line={l} index={i} removable={lines.length > 1} onChange={patch => update(l.key, patch)} onRemove={() => setLines(prev => prev.filter(x => x.key !== l.key))} />
        ))}
        <Card>
          <TextField
            label="Overall Notes (optional)"
            value={notes}
            onChangeText={setNotes}
            multiline
            placeholder="Delivery requirements, project context, urgency…"
          />
        </Card>
      </View>
    </Screen>
  )
}
