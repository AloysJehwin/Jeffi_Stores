import { useState } from 'react'
import { Alert, Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import { getSubscriptions, subscriptionAction, type SubscriptionItem } from '../../src/api/account'
import { listAddresses } from '../../src/api/addresses'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import HeroIcon from '../../src/components/account/HeroIcon'
import { useRequireAuth } from '../../src/components/account/hooks'
import { absUrl } from '../../src/lib/links'
import { showToast } from '../../src/stores/toastStore'
import { useTokens } from '../../src/theme'
import { Text, Skeleton } from '../../src/ui'

// Mirror of controller-service components/subscriptions/MySubscriptions.tsx (visitor).

type Action = 'cancel' | 'pause' | 'resume' | 'address'

const STATUS_TONE: Record<string, { bg: string; text: string }> = {
  active: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-400' },
  authenticated: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-400' },
  created: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-400' },
  pending: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-400' },
  paused: { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-800 dark:text-amber-400' },
  halted: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-400' },
}
const DEFAULT_TONE = { bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-300' }
const ENDED = new Set(['cancelled', 'completed', 'expired'])

const formatInr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

function Btn({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} className={`px-3 py-1.5 rounded-lg border border-border-secondary ${disabled ? 'opacity-50' : ''}`}>
      <Text className={`text-sm font-medium ${danger ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{label}</Text>
    </Pressable>
  )
}

function confirm(title: string, message: string, confirmLabel: string, danger = false): Promise<boolean> {
  return new Promise(resolve =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: danger ? 'destructive' : 'default', onPress: () => resolve(true) },
    ])
  )
}

// Subscription cards: image, name + status, plan lines, action buttons.
function SubscriptionsLoading() {
  return (
    <>
      {[0, 1].map(i => (
        <View key={i} className="gap-3 rounded-lg border border-border-default bg-surface-elevated p-4">
          <View className="flex-row items-start gap-3">
            <Skeleton width={64} height={64} rounded="rounded" />
            <View className="flex-1 gap-2">
              <View className="flex-row items-center gap-2">
                <Skeleton height={15} width="50%" />
                <Skeleton height={20} width={64} rounded="rounded-full" />
              </View>
              <Skeleton height={12} width="75%" />
              <Skeleton height={12} width="45%" />
              <Skeleton height={10} width="85%" rounded="rounded" />
            </View>
          </View>
          <View className="flex-row gap-2">
            <Skeleton height={32} width={64} rounded="rounded-lg" />
            <Skeleton height={32} width={124} rounded="rounded-lg" />
            <Skeleton height={32} width={68} rounded="rounded-lg" />
          </View>
        </View>
      ))}
    </>
  )
}

export default function SubscriptionsScreen() {
  const insets = useSafeAreaInsets()
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
    if (await confirm(copy.title, copy.message, copy.label, copy.danger)) run(s.id, action)
  }

  const changeAddress = async (id: string, addressId: string) => {
    if (await confirm('Change delivery address?', 'Future cycles will ship to the selected address.', 'Change address')) run(id, 'address', addressId)
  }

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <AccountMobileHeader />
        <View className="px-4 pt-4 gap-4">
          {!user || isLoading ? (
            <SubscriptionsLoading />
          ) : subs.length === 0 ? (
            <View className="bg-surface-elevated rounded-lg border border-border-default p-8 items-center">
              <Text className="text-foreground-secondary mb-3">You have no subscriptions yet.</Text>
              <Pressable onPress={() => router.navigate('/(tabs)')}>
                <Text className="text-accent-600 font-medium">Browse products</Text>
              </Pressable>
            </View>
          ) : (
            subs.map(s => {
              const ended = ENDED.has(s.status)
              const canCancel = !ended && !s.cancelAtCycleEnd && s.status !== 'created'
              const canPause = s.status === 'active' && !s.cancelAtCycleEnd
              const canResume = s.status === 'paused'
              const canAddress = !s.isDigital && !ended
              const paid = s.currentCycle ?? 0
              const locked = !!s.minCycles && paid < s.minCycles
              const tone = STATUS_TONE[s.status] ?? DEFAULT_TONE
              const img = absUrl(s.imageUrl)
              return (
                <View key={s.id} className="bg-surface-elevated rounded-lg border border-border-default p-4 gap-3">
                  <View className="flex-row gap-3 items-start">
                    {img && <Image source={{ uri: img }} style={{ width: 64, height: 64, borderRadius: 4 }} contentFit="cover" />}
                    <View className="flex-1">
                      <View className="flex-row flex-wrap items-center gap-2">
                        <Text onPress={() => router.push(`/product/${s.productSlug}`)} className="font-semibold text-foreground" numberOfLines={1}>
                          {s.productName}
                        </Text>
                        <View className={`px-2 py-0.5 rounded-full ${tone.bg}`}>
                          <Text className={`text-xs font-semibold ${tone.text}`}>{s.statusLabel}</Text>
                        </View>
                        {s.cancelAtCycleEnd && !ended && <Text className="text-xs text-foreground-muted">Ends {fmtDate(s.currentEnd)}</Text>}
                      </View>
                      <Text className="text-sm text-foreground-secondary">
                        {formatInr(s.amount)} · {s.intervalLabel}
                        {!s.isDigital && ` · Qty ${s.quantity}`}
                        {s.totalCycles ? ` · Cycle ${paid} of ${s.totalCycles}` : ''}
                      </Text>
                      {!ended && !s.cancelAtCycleEnd && !!s.nextChargeAt && <Text className="text-sm text-foreground-secondary">Next charge {fmtDate(s.nextChargeAt)}</Text>}
                      {s.isDigital && !!s.accessExpiresAt && <Text className="text-sm text-foreground-secondary">Access until {fmtDate(s.accessExpiresAt)}</Text>}
                      {s.address && (
                        <Text className="text-xs text-foreground-muted">
                          {s.address.name}, {s.address.line1}, {s.address.city}, {s.address.state} {s.address.pincode}
                        </Text>
                      )}
                    </View>
                  </View>

                  {!ended && (
                    <View className="flex-row flex-wrap gap-2">
                      {canPause && <Btn label="Pause" disabled={busy === s.id || locked} onPress={() => ask(s, 'pause')} />}
                      {canResume && <Btn label="Resume" disabled={busy === s.id} onPress={() => ask(s, 'resume')} />}
                      {canAddress && <Btn label="Change address" disabled={busy === s.id} onPress={() => setAddressFor(s.id)} />}
                      {canCancel && <Btn label="Cancel" danger disabled={busy === s.id || locked} onPress={() => ask(s, 'cancel')} />}
                      {locked && (canPause || canCancel) && (
                        <Text className="w-full text-xs text-foreground-muted">
                          Minimum {s.minCycles} charges: you can cancel or pause after charge {s.minCycles} ({paid} paid so far).
                        </Text>
                      )}
                    </View>
                  )}

                  {addressFor === s.id && (
                    <View className="border border-border-default rounded-lg p-3 gap-2">
                      <Text className="text-sm font-medium text-foreground">Deliver future cycles to</Text>
                      {addresses.length === 0 ? (
                        <Text className="text-sm text-foreground-muted">
                          No saved addresses.{' '}
                          <Text className="text-accent-600" onPress={() => router.push('/account/addresses')}>
                            Add one
                          </Text>
                        </Text>
                      ) : (
                        addresses.map(a => (
                          <Pressable key={a.id} disabled={busy === s.id} onPress={() => changeAddress(s.id, a.id)} className="px-3 py-2 rounded">
                            <Text className="text-sm text-foreground">
                              {a.full_name} — {a.city} {a.postal_code}
                            </Text>
                          </Pressable>
                        ))
                      )}
                      <Pressable onPress={() => setAddressFor(null)} className="self-start">
                        <Text className="text-sm text-foreground-muted">Close</Text>
                      </Pressable>
                    </View>
                  )}

                  {s.orders.length > 0 && (
                    <View>
                      <Pressable onPress={() => setOpenOrders(o => ({ ...o, [s.id]: !o[s.id] }))} className="flex-row items-center gap-1">
                        <View style={{ transform: [{ rotate: openOrders[s.id] ? '0deg' : '-90deg' }] }}>
                          <HeroIcon name="chevronDown" size={14} color={t.foregroundSecondary} />
                        </View>
                        <Text className="text-sm text-foreground-secondary">Cycle orders ({s.orders.length})</Text>
                      </Pressable>
                      {openOrders[s.id] && (
                        <View className="mt-2 gap-1">
                          {s.orders.map(o => (
                            <View key={o.id} className="flex-row justify-between gap-2">
                              <Text className="text-sm text-accent-600" onPress={() => router.push(`/orders/${o.id}`)}>
                                Cycle {o.cycle} · {o.orderNumber}
                              </Text>
                              <Text className="text-sm text-foreground-secondary">
                                {fmtDate(o.createdAt)} · {formatInr(o.total)}
                              </Text>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  )}
                </View>
              )
            })
          )}
        </View>
      </ScrollView>
    </View>
  )
}
