import { View } from 'react-native'
import { Image } from 'expo-image'
import { Button, Card, Checkbox, Divider, Heading, Label, Notice, Radio, SelectField, Text, TextField } from '../../ui'
import { DAY, fmtQty, REASONS, thumbOf, type Order, type ReturnRequest } from './shared'

/** The items of an open return or replacement request. */
export function ReturnItems({ returnRequest }: { returnRequest: ReturnRequest }) {
  const items = returnRequest.items ?? []
  return (
    <Card>
      <Heading>{returnRequest.type === 'replacement' ? 'Items Requested for Replacement' : 'Items Being Returned'}</Heading>
      <Text className="mt-0.5 text-sm text-foreground-secondary">
        ₹{items.reduce((s, i) => s + parseFloat(String(i.refund_amount)), 0).toLocaleString('en-IN')} {returnRequest.type === 'refund' ? 'refund' : 'value'}
      </Text>
      <View className="mt-3 overflow-hidden rounded-field bg-surface">
        {items.map((item, idx) => (
          <View key={item.id ?? idx}>
            {idx > 0 ? <Divider /> : null}
            <View className="flex-row items-center justify-between px-3 py-2.5">
              <View className="flex-1">
                <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                  {item.product_name}
                </Text>
                {!!item.variant_name && <Text className="text-xs text-foreground-secondary">{item.variant_name}</Text>}
              </View>
              <View className="ml-4 items-end">
                <Text className="text-xs text-foreground-secondary">
                  Qty {fmtQty(item.quantity)} × ₹{parseFloat(String(item.unit_price)).toLocaleString('en-IN')}
                </Text>
                <Text className="text-sm font-semibold text-foreground">₹{parseFloat(String(item.refund_amount)).toLocaleString('en-IN')}</Text>
              </View>
            </View>
          </View>
        ))}
      </View>
    </Card>
  )
}

/** The return / replacement request form: type, items, reason and a description. */
export function ReturnForm({
  order,
  title,
  canRefund,
  canReplace,
  deliveryTs,
  returnType,
  onType,
  selected,
  onToggle,
  reason,
  onReason,
  description,
  onDescription,
  error,
  submitting,
  onSubmit,
  onCancel,
}: {
  order: Order
  title: string
  canRefund: boolean
  canReplace: boolean
  deliveryTs: number
  returnType: 'refund' | 'replacement'
  onType: (t: 'refund' | 'replacement') => void
  selected: Record<string, boolean>
  onToggle: (itemId: string, on: boolean) => void
  reason: string
  onReason: (v: string) => void
  description: string
  onDescription: (v: string) => void
  error: string
  submitting: boolean
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <Card>
      <Heading className="mb-4">{title}</Heading>
      {!!error && (
        <Notice tone="danger" className="mb-4">
          {error}
        </Notice>
      )}
      <View className="gap-4">
        {canRefund && canReplace && (
          <View>
            <Label>What would you like?</Label>
            <View accessibilityRole="radiogroup" className="flex-row gap-6">
              {(['refund', 'replacement'] as const).map(rt => (
                <Radio key={rt} selected={returnType === rt} onSelect={() => onType(rt)} label={rt === 'refund' ? 'Refund' : 'Replacement'} />
              ))}
            </View>
          </View>
        )}
        <View>
          <Label required>Select items to return</Label>
          <View className="overflow-hidden rounded-field bg-surface px-3">
            {order.items.map(item => {
              const eligible =
                returnType === 'refund'
                  ? item.returnAllowed && Date.now() <= deliveryTs + item.returnWindowDays * DAY
                  : item.replacementAllowed && Date.now() <= deliveryTs + item.replacementWindowDays * DAY
              if (!eligible) return null
              const checked = !!selected[item.id]
              const thumb = thumbOf(item)
              return (
                <Checkbox key={item.id} checked={checked} onChange={on => onToggle(item.id, on)}>
                  <View className="flex-row items-center gap-3">
                    {thumb && <Image recyclingKey={thumb} source={{ uri: thumb }} style={{ width: 40, height: 40, borderRadius: 10 }} contentFit="cover" />}
                    <View className="flex-1">
                      <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
                        {item.productName}
                      </Text>
                      {!!item.variantName && (
                        <Text className="text-xs text-foreground-secondary">
                          {item.variantName}
                          {item.subVariantName ? ` / ${item.subVariantName}` : ''}
                        </Text>
                      )}
                      <Text className="text-xs text-foreground-muted">
                        Qty: {fmtQty(item.quantity)} · ₹{item.unitPrice.toFixed(0)}
                      </Text>
                    </View>
                  </View>
                </Checkbox>
              )
            })}
          </View>
        </View>
        <SelectField label="Reason" value={reason} placeholder="Select a reason…" options={REASONS} onChange={onReason} />
        <TextField
          label="Description (optional)"
          value={description}
          onChangeText={onDescription}
          multiline
          maxLength={500}
          placeholder="Please describe the issue in detail..."
          helper={`${description.length}/500`}
        />
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Button label="Cancel" variant="secondary" size="md" disabled={submitting} onPress={onCancel} />
          </View>
          <View className="flex-1">
            <Button label="Submit Request" loadingLabel="Submitting..." loading={submitting} size="md" onPress={onSubmit} />
          </View>
        </View>
      </View>
    </Card>
  )
}
