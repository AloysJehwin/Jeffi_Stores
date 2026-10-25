import { useState } from 'react'
import { Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { getTracking, type TrackingData, type TrackingScan } from '../../api/account'
import HeroIcon from './HeroIcon'
import { accent, useTokens } from '../../theme'
import { Skeleton } from '../../ui'

// Mirror of controller-service components/DelhiveryTracking.tsx (customer variant).

const EXCEPTION_TYPES = new Set(['UD', 'NDR', 'HOLD', 'LOST', 'MIS'])

function resolveDisplayType(statusType: string | null, scans: TrackingScan[]): string | null {
  const type = statusType?.toUpperCase() ?? ''
  const staleCreated = type === 'PP' || type === 'MF'
  if (!EXCEPTION_TYPES.has(type) && !staleCreated) return statusType
  for (const scan of scans) {
    const a = (scan?.activity ?? '').toLowerCase()
    if (a.includes('delivered') && !a.includes('out for')) return 'DL'
    if (a.includes('out for delivery')) return 'OD'
    if (a.includes('rto delivered') || a.includes('return delivered') || a.includes('returned to origin')) return 'RTO-DL'
    if (a.includes('out for return')) return 'RTO-OT'
    if (a.includes('return in transit') || a.includes('in return transit')) return 'RTO-IT'
    if (a.includes('rto initiated') || a.includes('return initiated')) return 'RTO'
    if (a.includes('in transit') || a === 'transit') return 'IT'
    if (a.includes('picked up') || a.includes('shipment picked') || a.includes('pickup')) return 'PU'
    if (a === 'manifested' || a.includes('manifest')) return 'MF'
  }
  return statusType
}

const DB_TYPE: Record<string, string> = {
  created: 'PP',
  picked_up: 'PU',
  in_transit: 'IT',
  out_for_delivery: 'OD',
  delivery_attempted: 'NDR',
  delivered: 'DL',
  rto_initiated: 'RTO',
  rto_in_transit: 'RTO-IT',
  rto_out_for_return: 'RTO-OT',
  rto_delivered: 'RTO-DL',
}

const BADGE: Record<string, { bg: string; text: string }> = {
  green: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300' },
  blue: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300' },
  yellow: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300' },
  orange: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-800 dark:text-orange-300' },
  red: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300' },
  neutral: { bg: 'bg-surface-secondary', text: 'text-foreground-secondary' },
}

function badge(type: string | null) {
  switch (type?.toUpperCase()) {
    case 'DL':
      return BADGE.green
    case 'OT':
    case 'OD':
    case 'DISPATCHED':
      return BADGE.blue
    case 'IT':
    case 'PU':
      return BADGE.yellow
    case 'NDR':
      return BADGE.orange
    case 'RTO':
    case 'RTO-IT':
    case 'RTO-OT':
    case 'RTO-DL':
    case 'HOLD':
    case 'MIS':
    case 'LOST':
      return BADGE.red
    default:
      return BADGE.neutral
  }
}

const LABEL: Record<string, string> = {
  PP: 'Shipment Created',
  MF: 'Shipment Created',
  PU: 'Picked Up',
  IT: 'In Transit',
  OT: 'Out for Delivery',
  OD: 'Out for Delivery',
  DISPATCHED: 'Out for Delivery',
  DL: 'Delivered',
  NDR: 'Delivery Attempted',
  RTO: 'Return Initiated',
  'RTO-IT': 'Returning to Origin',
  'RTO-OT': 'Out for Return',
  'RTO-DL': 'Returned to Origin',
  HOLD: 'On Hold',
  MIS: 'Misrouted',
  LOST: 'Lost',
}
const label = (type: string | null) => LABEL[type?.toUpperCase() ?? ''] ?? (type || 'In Progress')

const FORWARD_STEP: Record<string, number> = { delivered: 4, delivery_attempted: 3, out_for_delivery: 3, in_transit: 2, picked_up: 1 }
const REVERSE_STEP: Record<string, number> = {
  delivered: 4,
  rto_delivered: 4,
  out_for_delivery: 3,
  rto_out_for_return: 3,
  in_transit: 2,
  rto_in_transit: 2,
  rto_initiated: 1,
  picked_up: 1,
}
const STEPS = ['Shipment Created', 'Picked Up', 'In Transit', 'Out for Delivery', 'Delivered']
const REVERSE_STEPS = ['Pickup Scheduled', 'Picked Up', 'In Transit', 'Out for Return', 'Received']

const RANK: Record<string, number> = { PP: 1, MF: 1, PU: 2, IT: 3, OT: 4, OD: 4, NDR: 5, DL: 6, RTO: 7, 'RTO-IT': 8, 'RTO-OT': 9, 'RTO-DL': 10 }

function Timeline({ tracking }: { tracking: TrackingData }) {
  const reverse = tracking.orderType === 'Pickup' || tracking.reverseInTransit === true
  const active = (reverse ? REVERSE_STEP : FORWARD_STEP)[tracking.shipmentStatus ?? ''] ?? 0
  const steps = reverse ? REVERSE_STEPS : STEPS
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View className="flex-row items-start" style={{ minWidth: 480 }}>
        {steps.map((step, i) => {
          const done = i < active
          const current = i === active
          return (
            <View key={step} className="flex-1 items-center">
              {i > 0 && <View className={`absolute left-0 h-0.5 w-1/2 ${done || current ? 'bg-accent-500' : 'bg-border-default'}`} style={{ top: 13 }} />}
              {i < steps.length - 1 && <View className={`absolute right-0 h-0.5 w-1/2 ${done ? 'bg-accent-500' : 'bg-border-default'}`} style={{ top: 13 }} />}
              <View
                className={`z-10 w-7 h-7 rounded-full border-2 items-center justify-center ${
                  done ? 'bg-accent-500 border-accent-500' : current ? 'bg-surface-elevated border-accent-500' : 'bg-surface border-border-default'
                }`}
              >
                {done ? <HeroIcon name="check" size={14} color="white" strokeWidth={3} /> : <View className={`w-2.5 h-2.5 rounded-full ${current ? 'bg-accent-500' : 'bg-border-default'}`} />}
              </View>
              <Text className={`mt-2 text-xs text-center px-1 ${current ? 'text-accent-500 font-semibold' : done ? 'text-foreground font-medium' : 'text-foreground-muted'}`}>
                {step}
              </Text>
            </View>
          )
        })}
      </View>
    </ScrollView>
  )
}

function History({ scans, onClose }: { scans: TrackingScan[]; onClose: () => void }) {
  const t = useTokens()
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/20" onPress={onClose}>
        <Pressable onPress={() => {}} className="bg-surface-elevated rounded-t-xl" style={{ maxHeight: '80%' }}>
          <View className="flex-row items-center justify-between px-5 py-4 border-b border-border-default">
            <Text className="font-semibold text-foreground text-base">Shipment History</Text>
            <Pressable onPress={onClose} className="w-8 h-8 rounded-full items-center justify-center">
              <HeroIcon name="x" size={16} color={t.foregroundMuted} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <View className="border-l-2 border-border-default ml-2">
              {scans.map((scan, i) => (
                <View key={i} className="pl-4 pb-4">
                  <View className={`absolute w-2 h-2 rounded-full ${i === 0 ? 'bg-accent-500' : 'bg-border-default'}`} style={{ left: -5, top: 6 }} />
                  <Text className="text-xs text-foreground-muted">{scan.date ? new Date(scan.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}</Text>
                  <Text className="text-sm text-foreground font-medium">{scan.activity || '—'}</Text>
                  {!!scan.location && <Text className="text-xs text-foreground-secondary">{scan.location}</Text>}
                  {!!scan.instructions && <Text className="text-xs text-foreground-muted italic">{scan.instructions}</Text>}
                </View>
              ))}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

export default function OrderTracking({ orderId, trackPath = 'track' }: { orderId: string; trackPath?: string }) {
  const [showHistory, setShowHistory] = useState(false)
  const { data, isLoading, isError } = useQuery({
    queryKey: ['order-tracking', orderId, trackPath],
    queryFn: () => getTracking(orderId, trackPath),
    retry: 0,
  })

  if (isLoading) {
    // The stepper, then the status pill and AWB.
    return (
      <View className="gap-4">
        <View className="overflow-hidden">
          <View className="flex-row items-start" style={{ minWidth: 480 }}>
            {STEPS.map(step => (
              <View key={step} className="flex-1 items-center gap-2">
                <Skeleton width={28} height={28} rounded="rounded-full" />
                <Skeleton width="70%" height={10} rounded="rounded" />
              </View>
            ))}
          </View>
        </View>
        <View className="flex-row items-center gap-3">
          <Skeleton width={96} height={24} rounded="rounded-full" />
          <Skeleton width={140} height={13} />
        </View>
      </View>
    )
  }
  const tracking = data?.tracking
  if (isError || data?.error || !tracking) {
    return <Text className="text-sm text-foreground-muted py-1">{data?.error || (isError ? 'Could not load tracking' : 'Tracking information not yet available.')}</Text>
  }

  const fromApi = tracking.statusType ? resolveDisplayType(tracking.statusType, tracking.scans) : null
  const fromDb = DB_TYPE[tracking.shipmentStatus ?? ''] ?? null
  const apiRank = RANK[fromApi?.toUpperCase() ?? ''] ?? 0
  const dbRank = RANK[fromDb?.toUpperCase() ?? ''] ?? 0
  const displayType = dbRank > apiRank ? fromDb : (fromApi ?? fromDb)
  const tone = badge(displayType)
  const latest = tracking.scans?.[0]

  const facts = [
    tracking.origin && { k: 'Origin', v: tracking.origin },
    tracking.destination && { k: 'Destination', v: tracking.destination },
    tracking.pickUpDate && { k: 'Picked Up', v: new Date(tracking.pickUpDate).toLocaleDateString('en-IN') },
    tracking.expectedDelivery && { k: 'Expected Delivery', v: new Date(tracking.expectedDelivery).toLocaleDateString('en-IN') },
  ].filter(Boolean) as { k: string; v: string }[]

  return (
    <View className="gap-4">
      {showHistory && <History scans={tracking.scans} onClose={() => setShowHistory(false)} />}
      <Timeline tracking={tracking} />
      <View className="flex-row flex-wrap items-start gap-3">
        <View className={`px-3 py-1 rounded-full ${tone.bg}`}>
          <Text className={`text-xs font-semibold ${tone.text}`}>{label(displayType)}</Text>
        </View>
        <Text className="text-sm text-foreground-secondary">
          AWB: <Text className="font-mono text-foreground">{tracking.awb}</Text>
        </Text>
      </View>
      {!!tracking.status && <Text className="text-sm text-foreground leading-relaxed">{tracking.status.replace(/<br\s*\/?>/gi, ' ')}</Text>}
      {facts.length > 0 && (
        <View className="flex-row flex-wrap" style={{ rowGap: 12 }}>
          {facts.map(f => (
            <View key={f.k} style={{ width: '50%' }}>
              <Text className="text-foreground-secondary text-xs">{f.k}</Text>
              <Text className="text-foreground font-medium text-sm">{f.v}</Text>
            </View>
          ))}
        </View>
      )}
      {tracking.scans?.length > 0 && (
        <View className="flex-row items-center justify-between border-t border-border-default pt-3 gap-2">
          <Text className="flex-1 text-xs text-foreground-secondary">
            Last update: {latest?.date ? new Date(latest.date).toLocaleString('en-IN') : '—'}
            {latest?.location ? ` · ${latest.location}` : ''}
          </Text>
          <Pressable onPress={() => setShowHistory(true)} className="flex-row items-center gap-1">
            <Text className="text-sm text-accent-500">View history ({tracking.scans.length})</Text>
            <HeroIcon name="chevronRight" size={14} color={accent[500]} />
          </Pressable>
        </View>
      )}
    </View>
  )
}
