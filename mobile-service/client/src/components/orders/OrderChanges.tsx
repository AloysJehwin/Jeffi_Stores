import { View } from 'react-native'
import { TriangleAlert } from 'lucide-react-native'
import { Button, Notice, Text } from '../../ui'
import type { Order } from './shared'

/** "Cancel this order?" in place, with the request button and "Keep Order". */
export function CancelConfirm({ unpaidPending, busy, onConfirm, onKeep }: { unpaidPending: boolean; busy: boolean; onConfirm: () => void; onKeep: () => void }) {
  return (
    <Notice tone="danger" title={unpaidPending ? 'Cancel this order?' : 'Request cancellation for this order?'}>
      <Text className="mt-0.5 text-sm leading-5 text-red-700 dark:text-red-300">
        {unpaidPending
          ? 'This order will be cancelled immediately and stock will be restored. This action cannot be undone.'
          : 'Your cancellation request will be sent to our team for review. You will be notified once it is approved or rejected.'}
      </Text>
      <View className="mt-3 flex-row flex-wrap gap-2">
        <Button
          label={unpaidPending ? 'Yes, Cancel Order' : 'Yes, Request Cancellation'}
          loadingLabel={unpaidPending ? 'Cancelling...' : 'Submitting...'}
          loading={busy}
          variant="destructive"
          size="sm"
          block={false}
          onPress={onConfirm}
        />
        <Button label="Keep Order" variant="outline" size="sm" block={false} disabled={busy} onPress={onKeep} />
      </View>
    </Notice>
  )
}

function Actions({ confirmLabel, busy, onConfirm, onDecline }: { confirmLabel: string; busy: boolean; onConfirm: () => void; onDecline: () => void }) {
  return (
    <View className="mt-3 flex-row flex-wrap gap-2">
      <Button label={confirmLabel} loadingLabel="Processing…" loading={busy} size="sm" block={false} onPress={onConfirm} />
      <Button label="Decline" variant="ghost" size="sm" block={false} disabled={busy} onPress={onDecline} />
    </View>
  )
}

/** A store-proposed change to the order's lines, with its settlement. */
export function AdjustmentNotice({ order, busy, onConfirm, onDecline }: { order: Order; busy: boolean; onConfirm: () => void; onDecline: () => void }) {
  const a = order.pendingAdjustment!
  const amt = `₹${Math.abs(Number(a.net_diff)).toFixed(2)}`
  const q = (n: number, u: string | null) => `${n}${u ? ` ${u}` : ''}`
  return (
    <Notice tone="warning" icon={TriangleAlert} title={a.status === 'awaiting_payment' ? 'Complete the payment to apply the changes' : 'Changes to your order need your approval'}>
      <View className="mt-1.5 gap-1">
        {(a.lines || []).map((l, i) => (
          <Text key={i} className="text-sm text-foreground-secondary">
            {l.action === 'remove' ? (
              <>
                Remove <Text className="line-through">{l.old.name}</Text> ({q(l.old.quantity, l.old.unit)})
              </>
            ) : l.action === 'quantity' ? (
              <>
                {l.old.name}: {q(l.old.quantity, l.old.unit)} → <Text className="font-bold">{q(l.new!.quantity, l.new!.unit)}</Text>
              </>
            ) : (
              <>
                <Text className="line-through">{l.old.name}</Text> → <Text className="font-bold">{l.new!.productName}</Text> ({q(l.new!.quantity, l.new!.unit)})
              </>
            )}
          </Text>
        ))}
      </View>
      <Text className="mt-2 text-sm text-foreground">
        {a.settlement_type === 'refund' ? (
          <>
            We&apos;ll <Text className="font-bold">refund {amt}</Text> to your original payment.
          </>
        ) : a.settlement_type === 'collect' ? (
          <>
            An extra <Text className="font-bold">{amt}</Text> is payable — you&apos;ll pay it securely on confirm.
          </>
        ) : a.settlement_type === 'cod_adjust' ? (
          <>
            Your new total is <Text className="font-bold">₹{Number(a.new_total).toFixed(2)}</Text>, payable on delivery.
          </>
        ) : (
          'No change to what you pay.'
        )}
      </Text>
      <Actions confirmLabel={a.settlement_type === 'collect' ? `Confirm & pay ${amt}` : 'Confirm changes'} busy={busy} onConfirm={onConfirm} onDecline={onDecline} />
    </Notice>
  )
}

/** A store-proposed variant swap, with its settlement. */
export function VariantChangeNotice({ order, busy, onConfirm, onDecline }: { order: Order; busy: boolean; onConfirm: () => void; onDecline: () => void }) {
  const vc = order.pendingVariantChange!
  return (
    <Notice tone="warning" icon={TriangleAlert} title="A variant change needs your approval">
      <Text className="mt-1 text-sm text-foreground-secondary">
        For <Text className="font-bold">{vc.productName}</Text>, we propose changing <Text className="line-through">{vc.oldVariantName || '—'}</Text> →{' '}
        <Text className="font-bold">{vc.newVariantName || '—'}</Text>.
      </Text>
      <Text className="mt-1 text-sm text-foreground">
        {vc.settlementType === 'refund' ? (
          <>
            We&apos;ll <Text className="font-bold">refund ₹{Math.abs(vc.priceDiff).toFixed(2)}</Text> to your original payment.
          </>
        ) : vc.settlementType === 'collect' ? (
          <>
            An extra <Text className="font-bold">₹{Math.abs(vc.priceDiff).toFixed(2)}</Text> is payable — you&apos;ll pay it securely on confirm.
          </>
        ) : vc.settlementType === 'cod_adjust' ? (
          'Your total will be adjusted; you pay the updated amount on delivery.'
        ) : (
          'No change to your total.'
        )}
      </Text>
      <Actions confirmLabel={vc.settlementType === 'collect' ? 'Confirm & pay difference' : 'Confirm change'} busy={busy} onConfirm={onConfirm} onDecline={onDecline} />
    </Notice>
  )
}
