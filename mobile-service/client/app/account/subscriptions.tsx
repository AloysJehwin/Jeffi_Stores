import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, MapPin, Repeat } from 'lucide-react-native'
import { getSubscriptions, subscriptionAction, type SubscriptionItem } from '../../src/api/account'
import { listAddresses } from '../../src/api/addresses'
import { useRequireAuth } from '../../src/components/account/hooks'
import { absUrl } from '../../src/lib/links'
import { showToast } from '../../src/stores/toastStore'
import { useTokens } from '../../src/theme'
import { Badge, BodySmall, Button, Caption, Card, confirm, Divider, EmptyState, ListGroup, ListRow, Screen, Skeleton, Text, TextButton, type Tone } from '../../src/ui'

// Mirror of controller-service components/subscriptions/MySubscriptions.tsx (visitor).

type Action = 'cancel' | 'pause' | 'resume' | 'address'

const STATUS_TONE: Record<string, Tone> = {
  active: 'success',
  authenticated: 'info',
  created: 'info',
  pending: 'warning',
  paused: 'warning',
  halted: 'danger',
}
const ENDED = new Set(['cancelled', 'completed', 'expired'])

const formatInr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

// Subscription cards: image, name + status, plan lines, action buttons.
function SubscriptionsLoading() {
  return (
    <>
      {[0, 1].map(i => (
        <View key={i} className="gap-4 rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default">
          <View className="flex-row items-start gap-3">
            <Skeleton width={64} height={64} rounded="rounded-xl" />
            <View className="flex-1 gap-2">
              <View className="flex-row items-center gap-2">
                <Skeleton height={15} width="50%" />
                <Skeleton height={24} width={64} rounded="rounded-full" />
              </View>
              <Skeleton height={12} width="75%" />
              <Skeleton height={12} width="45%" />
              <Skeleton height={10} width="85%" rounded="rounded" />
            </View>
          </View>
          <View className="flex-row gap-2">
            <Skeleton height={40} width={76} rounded="rounded-xl" />
            <Skeleton height={40} width={140} rounded="rounded-xl" />
            <Skeleton height={40} width={80} rounded="rounded-xl" />
          </View>
        </View>
      ))}
    </>
  )
}

export default function SubscriptionsScreen() {
  const router = useRouter()
  const t = useTokens()
  const qc = useQueryClient()
  const user = useRequireAuth()
  const key = ['subscriptions', user?.id ?? null]
  const { data: subs = [], isLoading } = useQuery({ queryKey: key, queryFn: getSubscriptions, enabled: !!user })
  const [busy, setBusy] = useState<string | null>(null)
  const [addressFor, setAddressFor] = useState<string | null>(null)
  const [openOrders, setOpenOrders] = useState<Record<string, boolean>>({})
  const { data: addresses = [] } = useQuery({ queryKey: ['addresses'], queryFn: listAddresses, enabled: !!addressFor })

  const run = async (id: string, action: Action, addressId?: string) => {
    setBusy(id)
    try {
      const data = await subscriptionAction(id, action, addressId)
      qc.setQueryData<SubscriptionItem[]>(key, prev => (prev ?? []).map(s => (s.id === id ? data.subscription : s)))
      setAddressFor(null)
      showToast('Subscription updated', 'success')
    } catch (e: any) {
      showToast(e?.message || 'Could not update the subscription', 'error')
    } finally {
      setBusy(null)
    }
  }

  const ask = async (s: SubscriptionItem, action: Exclude<Action, 'address'>) => {
    const copy = {
      cancel: {
        title: 'Cancel subscription?',
        message: `It will stop renewing. You keep ${s.isDigital ? 'access' : 'deliveries'} until ${fmtDate(s.currentEnd)}.`,
        label: 'Cancel subscription',
        danger: true,
      },
      pause: { title: 'Pause subscription?', message: 'No further charges until you resume.', label: 'Pause', danger: false },
      resume: { title: 'Resume subscription?', message: 'Charges restart from the next cycle.', label: 'Resume', danger: false },
    }[action]
    if (await confirm({ title: copy.title, message: copy.message, confirmLabel: copy.label, destructive: copy.danger })) run(s.id, action)
  }

  const changeAddress = async (id: string, addressId: string) => {
    if (await confirm({ title: 'Change delivery address?', message: 'Future cycles will ship to the selected address.', confirmLabel: 'Change address' })) run(id, 'address', addressId)
  }

  return (
    <Screen title="Subscriptions" contentClassName="gap-4">
      {!user || isLoading ? (
        <SubscriptionsLoading />
      ) : subs.length === 0 ? (
        <EmptyState icon={Repeat} title="You have no subscriptions yet." actionLabel="Browse products" onAction={() => router.navigate('/(tabs)')} />
      ) : (
        subs.map(s => {
          const ended = ENDED.has(s.status)
          const canCancel = !ended && !s.cancelAtCycleEnd && s.status !== 'created'
          const canPause = s.status === 'active' && !s.cancelAtCycleEnd
          const canResume = s.status === 'paused'
          const canAddress = !s.isDigital && !ended
          const paid = s.currentCycle ?? 0
          const locked = !!s.minCycles && paid < s.minCycles
          const img = absUrl(s.imageUrl)
          const busyHere = busy === s.id
          return (
            <Card key={s.id} className="gap-4">
              <View className="flex-row items-start gap-3">
                {img && <Image source={{ uri: img }} style={{ width: 64, height: 64, borderRadius: 12 }} contentFit="cover" />}
                <View className="flex-1">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text onPress={() => router.push(`/product/${s.productSlug}`)} className="text-[15px] font-semibold text-foreground" numberOfLines={1}>
                      {s.productName}
                    </Text>
                    <Badge label={s.statusLabel} tone={STATUS_TONE[s.status] ?? 'neutral'} size="sm" />
                    {s.cancelAtCycleEnd && !ended && <Caption>Ends {fmtDate(s.currentEnd)}</Caption>}
                  </View>
                  <BodySmall className="mt-0.5">
                    {formatInr(s.amount)} · {s.intervalLabel}
                    {!s.isDigital && ` · Qty ${s.quantity}`}
                    {s.totalCycles ? ` · Cycle ${paid} of ${s.totalCycles}` : ''}
                  </BodySmall>
                  {!ended && !s.cancelAtCycleEnd && !!s.nextChargeAt && <BodySmall>Next charge {fmtDate(s.nextChargeAt)}</BodySmall>}
                  {s.isDigital && !!s.accessExpiresAt && <BodySmall>Access until {fmtDate(s.accessExpiresAt)}</BodySmall>}
                  {s.address && (
                    <Caption className="mt-1">
                      {s.address.name}, {s.address.line1}, {s.address.city}, {s.address.state} {s.address.pincode}
                    </Caption>
                  )}
                </View>
              </View>

              {!ended && (
                <View className="gap-2">
                  <View className="flex-row flex-wrap gap-2">
                    {canPause && <Button label="Pause" variant="secondary" size="sm" block={false} disabled={busyHere || locked} onPress={() => ask(s, 'pause')} />}
                    {canResume && <Button label="Resume" variant="secondary" size="sm" block={false} disabled={busyHere} onPress={() => ask(s, 'resume')} />}
                    {canAddress && <Button label="Change address" icon={MapPin} variant="secondary" size="sm" block={false} disabled={busyHere} onPress={() => setAddressFor(s.id)} />}
                    {canCancel && <Button label="Cancel" variant="destructive" size="sm" block={false} disabled={busyHere || locked} onPress={() => ask(s, 'cancel')} />}
                  </View>
                  {locked && (canPause || canCancel) && (
                    <Caption>
                      Minimum {s.minCycles} charges: you can cancel or pause after charge {s.minCycles} ({paid} paid so far).
                    </Caption>
                  )}
                </View>
              )}

              {addressFor === s.id && (
                <View className="gap-2">
                  <Text className="text-sm font-semibold text-foreground">Deliver future cycles to</Text>
                  {addresses.length === 0 ? (
                    <Text className="text-sm text-foreground-muted">
                      No saved addresses.{' '}
                      <Text className="font-semibold text-accent-600 dark:text-accent-400" onPress={() => router.push('/account/addresses')}>
                        Add one
                      </Text>
                    </Text>
                  ) : (
                    <ListGroup>
                      {addresses.map(a => (
                        <ListRow key={a.id} icon={MapPin} title={a.full_name} subtitle={`${a.city} ${a.postal_code}`} disabled={busyHere} onPress={() => changeAddress(s.id, a.id)} />
                      ))}
                    </ListGroup>
                  )}
                  <TextButton label="Close" tone="muted" onPress={() => setAddressFor(null)} />
                </View>
              )}

              {s.orders.length > 0 && (
                <View>
                  <Divider className="mb-3" />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ expanded: !!openOrders[s.id] }}
                    onPress={() => setOpenOrders(o => ({ ...o, [s.id]: !o[s.id] }))}
                    className="min-h-[36px] flex-row items-center gap-1.5"
                  >
                    <View style={{ transform: [{ rotate: openOrders[s.id] ? '0deg' : '-90deg' }] }}>
                      <ChevronDown size={16} color={t.foregroundSecondary} />
                    </View>
                    <Text className="text-sm font-medium text-foreground-secondary">Cycle orders ({s.orders.length})</Text>
                  </Pressable>
                  {openOrders[s.id] && (
                    <View className="mt-2 gap-2">
                      {s.orders.map(o => (
                        <View key={o.id} className="flex-row items-center justify-between gap-2">
                          <TextButton label={`Cycle ${o.cycle} · ${o.orderNumber}`} onPress={() => router.push(`/orders/${o.id}`)} />
                          <Text className="text-[13px] text-foreground-secondary">
                            {fmtDate(o.createdAt)} · {formatInr(o.total)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </Card>
          )
        })
      )}
    </Screen>
  )
}
