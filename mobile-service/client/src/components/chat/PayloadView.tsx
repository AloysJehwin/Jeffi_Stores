import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import { ChevronRight } from 'lucide-react-native'
import { Badge, Button, Chip, ChipGroup, Text, cn, statusTone } from '../../ui'
import { useTokens } from '../../theme'
import { inr } from '../../lib/format'
import { openHref } from '../../lib/links'
import type { ConfirmPayload, OrderCardPayload, SupportPayload } from '../../types/support'
import { shortDate } from './format'

// Rich parts of a message: confirm cards, order cards, reply chips, links (web: components/chat/PayloadView).

type Decide = (actionId: string, d: 'confirm' | 'decline') => Promise<void>

function ConfirmCard({ p, onDecide }: { p: ConfirmPayload; onDecide?: Decide }) {
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null)
  const decide = async (d: 'confirm' | 'decline') => {
    if (!onDecide || busy) return
    setBusy(d)
    try {
      await onDecide(p.actionId, d)
    } finally {
      setBusy(null)
    }
  }
  const settled =
    p.status === 'done' ? 'Done' : p.status === 'confirmed' ? 'Confirmed, working on it…' : p.status === 'declined' ? 'Declined' : p.status === 'failed' ? 'Could not complete' : p.status === 'expired' ? 'Expired' : null
  return (
    <View className="gap-2 rounded-xl border border-border-default bg-surface p-3">
      <Text className="text-sm font-semibold text-foreground">{p.title}</Text>
      {p.detail ? <Text className="text-xs leading-[18px] text-foreground-secondary">{p.detail}</Text> : null}
      {p.status === 'pending' && onDecide ? (
        <View className="flex-row gap-2 pt-1">
          <Button label={p.confirmLabel || 'Confirm'} size="sm" className="flex-1" loading={busy === 'confirm'} disabled={!!busy} haptics onPress={() => decide('confirm')} />
          <Button label="No, keep it" size="sm" variant="outline" className="flex-1" loading={busy === 'decline'} disabled={!!busy} onPress={() => decide('decline')} />
        </View>
      ) : (
        <Text
          className={cn(
            'text-xs font-medium',
            p.status === 'failed' ? 'text-red-600 dark:text-red-400' : p.status === 'done' ? 'text-green-700 dark:text-green-400' : 'text-foreground-muted'
          )}
        >
          {p.status === 'pending' ? 'Waiting for you to confirm' : settled}
          {p.resultText ? ` · ${p.resultText}` : ''}
        </Text>
      )}
    </View>
  )
}

function OrderCards({ p, onOrder }: { p: OrderCardPayload; onOrder?: (id: string) => void }) {
  const t = useTokens()
  return (
    <View className="gap-1.5">
      {p.orders.map(o => (
        <Pressable
          key={o.id}
          accessibilityRole={onOrder ? 'button' : undefined}
          accessibilityLabel={`Order ${o.number}, ${o.status.replace(/_/g, ' ')}, ₹${inr(o.total)}`}
          disabled={!onOrder}
          onPress={() => onOrder?.(o.id)}
          className="rounded-xl border border-border-default bg-surface px-3 py-2 active:bg-surface-secondary"
        >
          <View className="flex-row items-center justify-between gap-2">
            <Text className="text-xs font-bold text-foreground">#{o.number}</Text>
            <Badge size="sm" tone={statusTone(o.status)} label={o.status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} />
          </View>
          {o.items ? (
            <Text numberOfLines={1} className="mt-0.5 text-xs text-foreground-secondary">
              {o.items}
            </Text>
          ) : null}
          <View className="mt-0.5 flex-row items-center justify-between">
            <Text className="text-[11px] text-foreground-muted">{shortDate(o.placedAt)}</Text>
            <View className="flex-row items-center gap-1">
              <Text className="text-[11px] font-semibold text-foreground">₹{inr(o.total)}</Text>
              {onOrder ? <ChevronRight size={14} color={t.foregroundMuted} /> : null}
            </View>
          </View>
        </Pressable>
      ))}
    </View>
  )
}

interface Props {
  payloads: SupportPayload[]
  onDecide?: Decide
  /** A suggestion chip sends its text. */
  onChip?: (text: string) => void
  onOrder?: (id: string) => void
}

export default function PayloadView({ payloads, onDecide, onChip, onOrder }: Props) {
  const router = useRouter()
  const t = useTokens()
  if (!payloads.length) return null
  return (
    <View className="mt-1.5 gap-2">
      {payloads.map((p, i) => {
        if (p.type === 'confirm') return <ConfirmCard key={i} p={p} onDecide={onDecide} />
        if (p.type === 'orders') return <OrderCards key={i} p={p} onOrder={onOrder} />
        if (p.type === 'chips')
          return (
            <ChipGroup key={i}>
              {p.chips.map(c => (
                <Chip key={c.label} size="sm" label={c.label} disabled={!onChip} onPress={() => onChip?.(c.text)} />
              ))}
            </ChipGroup>
          )
        if (p.type === 'links')
          return (
            <View key={i} className="gap-1">
              {p.links.map(l => (
                <Pressable
                  key={l.href}
                  accessibilityRole="link"
                  onPress={() => openHref(router, l.href)}
                  className="min-h-[40px] flex-row items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 active:bg-surface-secondary"
                >
                  <Text numberOfLines={1} className="flex-1 text-sm text-foreground">
                    {l.label}
                  </Text>
                  <ChevronRight size={14} color={t.foregroundMuted} />
                </Pressable>
              ))}
            </View>
          )
        return null
      })}
    </View>
  )
}
