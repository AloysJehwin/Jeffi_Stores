'use client'

import { useEffect, useState } from 'react'
import { type ShipmentStatus, shipmentStatusToStep, shipmentStatusToReverseStep } from '@/lib/shipment-status'

type Scan = {
  date: string | null
  location: string | null
  activity: string | null
  instructions: string | null
}

type TrackingData = {
  awb: string
  status: string | null
  statusType: string | null
  shipmentStatus: ShipmentStatus | null
  statusDateTime: string | null
  pickUpDate: string | null
  expectedDelivery: string | null
  origin: string | null
  destination: string | null
  scans: Scan[]
  orderType?: string | null
  reverseInTransit?: boolean
  destReceiveDate?: string | null
  returnedDate?: string | null
  // Delivery cost breakdown
  quotedWeightKg?: number | null
  chargedWeightKg?: number | null
  shippingAmount?: number | null
  extraCharge?: number | null
  billedAmount?: number | null
  billedAt?: string | null
  freightCharge?: number | null
  codCharge?: number | null
  odaCharge?: number | null
}

const EXCEPTION_TYPES = new Set(['UD', 'NDR', 'HOLD', 'LOST', 'MIS'])

function resolveDisplayType(statusType: string | null, scans: Scan[]): string | null {
  const type = statusType?.toUpperCase() ?? ''

  const staleCreated = type === 'PP' || type === 'MF'
  if (!EXCEPTION_TYPES.has(type) && !staleCreated) return statusType

  for (let i = 0; i < scans.length; i++) {
    const activity = (scans[i]?.activity ?? '').toLowerCase()
    if (activity.includes('delivered') && !activity.includes('out for')) return 'DL'
    if (activity.includes('out for delivery')) return 'OD'
    if (
      activity.includes('rto delivered') ||
      activity.includes('return delivered') ||
      activity.includes('returned to origin')
    )
      return 'RTO-DL'
    if (activity.includes('out for return')) return 'RTO-OT'
    if (activity.includes('return in transit') || activity.includes('in return transit')) return 'RTO-IT'
    if (activity.includes('rto initiated') || activity.includes('return initiated')) return 'RTO'
    if (activity.includes('in transit') || activity === 'transit') return 'IT'
    if (activity.includes('picked up') || activity.includes('shipment picked') || activity.includes('pickup'))
      return 'PU'
    if (activity === 'manifested' || activity.includes('manifest')) return 'MF'
  }
  return statusType
}

// Derive a display type code from the DB shipment_status when live statusType is unavailable
function shipmentStatusToDisplayType(s: ShipmentStatus | null): string | null {
  switch (s) {
    case 'created':
      return 'PP'
    case 'picked_up':
      return 'PU'
    case 'in_transit':
      return 'IT'
    case 'out_for_delivery':
      return 'OD'
    case 'delivery_attempted':
      return 'NDR'
    case 'delivered':
      return 'DL'
    case 'rto_initiated':
      return 'RTO'
    case 'rto_in_transit':
      return 'RTO-IT'
    case 'rto_out_for_return':
      return 'RTO-OT'
    case 'rto_delivered':
      return 'RTO-DL'
    default:
      return null
  }
}

function statusBadge(type: string | null) {
  switch (type?.toUpperCase()) {
    case 'DL':
      return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    case 'OT':
    case 'OD':
    case 'DISPATCHED':
      return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'IT':
    case 'PU':
      return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
    case 'NDR':
      return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    case 'RTO':
    case 'RTO-IT':
    case 'RTO-OT':
    case 'RTO-DL':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'HOLD':
    case 'MIS':
    case 'LOST':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    default:
      return 'bg-surface-secondary text-foreground-secondary'
  }
}

function statusLabel(type: string | null) {
  switch (type?.toUpperCase()) {
    case 'PP':
      return 'Shipment Created'
    case 'MF':
      return 'Shipment Created'
    case 'PU':
      return 'Picked Up'
    case 'IT':
      return 'In Transit'
    case 'OT':
    case 'OD':
    case 'DISPATCHED':
      return 'Out for Delivery'
    case 'DL':
      return 'Delivered'
    case 'NDR':
      return 'Delivery Attempted'
    case 'RTO':
      return 'Return Initiated'
    case 'RTO-IT':
      return 'Returning to Origin'
    case 'RTO-OT':
      return 'Out for Return'
    case 'RTO-DL':
      return 'Returned to Origin'
    case 'HOLD':
      return 'On Hold'
    case 'MIS':
      return 'Misrouted'
    case 'LOST':
      return 'Lost'
    default:
      return type || 'In Progress'
  }
}

const TIMELINE_STEPS: { key: string; label: string }[] = [
  { key: 'created', label: 'Shipment Created' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'out', label: 'Out for Delivery' },
  { key: 'delivered', label: 'Delivered' },
]

const REVERSE_TIMELINE_STEPS: { key: string; label: string }[] = [
  { key: 'created', label: 'Pickup Scheduled' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'out', label: 'Out for Return' },
  { key: 'delivered', label: 'Received' },
]

function HorizontalTimeline({ tracking }: { tracking: TrackingData }) {
  const isReverse = tracking.orderType === 'Pickup' || tracking.reverseInTransit === true
  const activeStep = isReverse
    ? shipmentStatusToReverseStep(tracking.shipmentStatus)
    : shipmentStatusToStep(tracking.shipmentStatus)
  const steps = isReverse ? REVERSE_TIMELINE_STEPS : TIMELINE_STEPS

  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="flex items-start min-w-[480px]">
        {steps.map((step, i) => {
          const done = i < activeStep
          const current = i === activeStep
          return (
            <div key={step.key} className="flex-1 flex flex-col items-center relative">
              {i > 0 && (
                <div
                  className={`absolute left-0 top-3.5 h-0.5 w-1/2 ${done || current ? 'bg-accent-500' : 'bg-border-default'}`}
                />
              )}
              {i < steps.length - 1 && (
                <div
                  className={`absolute right-0 top-3.5 h-0.5 w-1/2 ${done ? 'bg-accent-500' : 'bg-border-default'}`}
                />
              )}
              <div
                className={`relative z-10 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors ${
                  done
                    ? 'bg-accent-500 border-accent-500'
                    : current
                      ? 'bg-white dark:bg-surface-elevated border-accent-500'
                      : 'bg-surface border-border-default'
                }`}
              >
                {done ? (
                  <svg
                    className="w-3.5 h-3.5 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <div className={`w-2.5 h-2.5 rounded-full ${current ? 'bg-accent-500' : 'bg-border-default'}`} />
                )}
              </div>
              <p
                className={`mt-2 text-xs text-center leading-tight px-1 ${
                  current
                    ? 'text-accent-500 font-semibold'
                    : done
                      ? 'text-foreground font-medium'
                      : 'text-foreground-muted'
                }`}
              >
                {step.label}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ScanHistoryModal({ scans, onClose }: { scans: Scan[]; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
      <div
        className="relative bg-surface-elevated w-full sm:max-w-lg sm:rounded-xl rounded-t-xl shadow-2xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-default shrink-0">
          <h3 className="font-semibold text-foreground text-base">Shipment History</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-surface transition-colors text-foreground-muted hover:text-foreground"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-5">
          <div className="border-l-2 border-border-default ml-2 space-y-0">
            {scans.map((scan, i) => (
              <div key={i} className="relative pl-4 pb-4">
                <div
                  className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${i === 0 ? 'bg-accent-500' : 'bg-border-default'}`}
                />
                <p className="text-xs text-foreground-muted">
                  {scan.date ? new Date(scan.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}
                </p>
                <p className="text-sm text-foreground font-medium">{scan.activity || '—'}</p>
                {scan.location && <p className="text-xs text-foreground-secondary">{scan.location}</p>}
                {scan.instructions && <p className="text-xs text-foreground-muted italic">{scan.instructions}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function DelhiveryTracking({
  orderId,
  apiBase = '/api/orders',
  variant = 'default',
  trackPath = 'track',
  headers: extraHeaders,
}: {
  orderId: string
  apiBase?: string
  variant?: 'default' | 'admin'
  trackPath?: string
  headers?: Record<string, string>
}) {
  const [tracking, setTracking] = useState<TrackingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [statusSynced, setStatusSynced] = useState<string | null>(null)

  const loadTracking = (refresh = false) => {
    const url = `${apiBase}/${orderId}/${trackPath}${refresh ? '?refresh=1' : ''}`
    if (refresh) setRefreshing(true)
    else setLoading(true)
    fetch(url, extraHeaders ? { headers: extraHeaders } : undefined)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else {
          setTracking(d.tracking)
          if (d.statusSynced && d.syncedTo) setStatusSynced(d.syncedTo)
        }
      })
      .catch(() => setError('Could not load tracking'))
      .finally(() => {
        setLoading(false)
        setRefreshing(false)
      })
  }

  useEffect(() => {
    loadTracking()
  }, [orderId, apiBase])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-foreground-secondary py-2">
        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading tracking…
      </div>
    )
  }

  if (error || !tracking) {
    return <p className="text-sm text-foreground-muted py-1">{error || 'Tracking information not yet available.'}</p>
  }

  const resolvedFromApi = tracking.statusType ? resolveDisplayType(tracking.statusType, tracking.scans) : null
  const resolvedFromDb = shipmentStatusToDisplayType(tracking.shipmentStatus)
  // If the DB shipment_status is more advanced than what the live API returned
  // (e.g. Delhivery returns PP/MF but we already know it's in_transit), prefer the DB value
  const DISPLAY_RANK: Record<string, number> = {
    PP: 1,
    MF: 1,
    PU: 2,
    IT: 3,
    OT: 4,
    OD: 4,
    NDR: 5,
    DL: 6,
    RTO: 7,
    'RTO-IT': 8,
    'RTO-OT': 9,
    'RTO-DL': 10,
  }
  const apiRank = DISPLAY_RANK[resolvedFromApi?.toUpperCase() ?? ''] ?? 0
  const dbRank = DISPLAY_RANK[resolvedFromDb?.toUpperCase() ?? ''] ?? 0
  const displayType = dbRank > apiRank ? resolvedFromDb : (resolvedFromApi ?? resolvedFromDb)
  const latestScan = tracking.scans?.[0]
  const isException = ['RTO', 'RTO-IT', 'RTO-OT', 'RTO-DL', 'NDR', 'HOLD', 'LOST', 'MIS'].includes(
    displayType?.toUpperCase() ?? ''
  )

  if (variant === 'admin') {
    return (
      <div className="space-y-5">
        {showHistory && <ScanHistoryModal scans={tracking.scans} onClose={() => setShowHistory(false)} />}

        {statusSynced && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-xs text-green-800 dark:text-green-300">
            <svg
              className="w-3.5 h-3.5 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Order status automatically updated to <span className="font-semibold capitalize">{statusSynced}</span> based
            on Delhivery tracking.
          </div>
        )}
        {isException && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
            Shipment exception: <span className="font-semibold">{statusLabel(displayType)}</span>
          </div>
        )}

        <HorizontalTimeline tracking={tracking} />

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm border-t border-border-default pt-4">
          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusBadge(displayType)}`}>
            {statusLabel(displayType)}
          </span>
          <span className="text-foreground-secondary">
            AWB: <span className="font-mono text-foreground">{tracking.awb}</span>
          </span>
          {tracking.origin && (
            <span className="text-foreground-secondary">
              Origin: <span className="text-foreground">{tracking.origin}</span>
            </span>
          )}
          {tracking.destination && (
            <span className="text-foreground-secondary">
              Dest: <span className="text-foreground">{tracking.destination}</span>
            </span>
          )}
          {tracking.pickUpDate && (
            <span className="text-foreground-secondary">
              Picked up:{' '}
              <span className="text-foreground">{new Date(tracking.pickUpDate).toLocaleDateString('en-IN')}</span>
            </span>
          )}
          {tracking.expectedDelivery && (
            <span className="text-foreground-secondary">
              EDD:{' '}
              <span className="text-foreground">{new Date(tracking.expectedDelivery).toLocaleDateString('en-IN')}</span>
            </span>
          )}
          <button
            onClick={() => loadTracking(true)}
            disabled={refreshing}
            className="ml-auto flex items-center gap-1.5 text-xs text-foreground-secondary hover:text-foreground disabled:opacity-50 transition-colors"
          >
            <svg
              className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            {refreshing ? 'Refreshing…' : 'Refresh live'}
          </button>
        </div>

        {tracking.scans?.length > 0 && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-foreground-secondary">
              Last update:{' '}
              {latestScan?.date ? new Date(latestScan.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}
              {latestScan?.location ? ` · ${latestScan.location}` : ''}
            </p>
            <button
              onClick={() => setShowHistory(true)}
              className="text-sm text-accent-500 hover:text-accent-600 flex items-center gap-1 shrink-0"
            >
              View history ({tracking.scans.length})
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        )}

        {/* Delivery cost breakdown — actual invoice, weight estimate, or quote only */}
        {/*
          Delivery cost is admin-only and stays inside this branch: it shows what Delhivery
          bills US, the shortfall against what the customer paid, and the freight/COD breakdown.
          The customer render below must never gain these fields — a shortfall is commercially
          sensitive, and the customer track API deliberately omits them too.
        */}
        {(tracking.shippingAmount != null || tracking.chargedWeightKg != null || tracking.billedAmount != null) &&
          (() => {
            const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`
            const hasBilled = tracking.billedAmount != null
            const quoted = tracking.shippingAmount != null ? Number(tracking.shippingAmount) : null

            // The "final" figure differs by state: actual billed, or quoted+estimate, or just quoted.
            const estExtra =
              !hasBilled && tracking.extraCharge != null && tracking.extraCharge > 0 ? Number(tracking.extraCharge) : 0
            const finalAmount = hasBilled ? Number(tracking.billedAmount) : quoted != null ? quoted + estExtra : null
            const diff = quoted != null && finalAmount != null ? Math.round((finalAmount - quoted) * 100) / 100 : null
            const overWeight =
              tracking.quotedWeightKg != null &&
              tracking.chargedWeightKg != null &&
              tracking.chargedWeightKg > tracking.quotedWeightKg

            // Delta chip styling: shortfall (we lost money) = orange, surplus = green, match = neutral.
            const canReprice = variant === 'admin' && !!tracking.awb
            const deltaTone =
              diff == null || diff === 0
                ? 'bg-surface-secondary text-foreground-secondary'
                : diff > 0
                  ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300'
                  : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'

            return (
              <div className="border-t border-border-default pt-4 mt-1">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-foreground-secondary uppercase tracking-wide">
                    Delivery Cost
                  </p>
                  <span
                    className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${hasBilled ? 'bg-accent-100 dark:bg-accent-900/30 text-accent-700 dark:text-accent-300' : 'bg-surface-secondary text-foreground-muted'}`}
                  >
                    {hasBilled ? 'Actual invoice' : estExtra > 0 ? 'Estimate' : 'Quoted'}
                  </span>
                </div>

                {/* Hero: Quoted → Final with delta chip */}
                <div className="flex items-stretch gap-2 mb-3">
                  <div className="flex-1 rounded-lg border border-border-default bg-surface px-3 py-2">
                    <p className="text-[10px] text-foreground-muted uppercase tracking-wide">Quoted</p>
                    <p className="text-base font-bold text-foreground tabular-nums">
                      {quoted != null ? inr(quoted) : '—'}
                    </p>
                    {tracking.quotedWeightKg != null && (
                      <p className="text-[10px] text-foreground-muted">{tracking.quotedWeightKg} kg</p>
                    )}
                  </div>
                  <div className="flex items-center text-foreground-muted">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                  </div>
                  <div
                    className={`flex-1 rounded-lg border px-3 py-2 ${diff && diff > 0 ? 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20' : hasBilled ? 'border-accent-300 dark:border-accent-700 bg-accent-50 dark:bg-accent-900/20' : 'border-border-default bg-surface'}`}
                  >
                    <p className="text-[10px] text-foreground-muted uppercase tracking-wide">
                      {hasBilled ? 'Billed' : estExtra > 0 ? 'Est. total' : 'Charged'}
                    </p>
                    <p className="text-base font-bold text-foreground tabular-nums">
                      {finalAmount != null ? inr(finalAmount) : '—'}
                    </p>
                    {tracking.chargedWeightKg != null && (
                      <p
                        className={`text-[10px] ${overWeight ? 'text-orange-600 dark:text-orange-400 font-medium' : 'text-foreground-muted'}`}
                      >
                        {tracking.chargedWeightKg} kg{overWeight ? ' ↑' : ''}
                      </p>
                    )}
                  </div>
                </div>

                {/* Delta chip */}
                {diff != null && diff !== 0 && (
                  <div
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold mb-3 ${deltaTone}`}
                  >
                    {diff > 0 ? (
                      <>
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                        </svg>
                        +{inr(Math.abs(diff))} over quote{!hasBilled ? ' (est.)' : ''}
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                        </svg>
                        −{inr(Math.abs(diff))} under quote
                      </>
                    )}
                  </div>
                )}

                {canReprice && (
                  <RepriceCharge
                    orderId={orderId}
                    apiBase={apiBase}
                    currentKg={tracking.chargedWeightKg ?? null}
                    currentAmount={tracking.billedAmount ?? null}
                    onDone={() => loadTracking(true)}
                  />
                )}

                {/* Itemized breakdown — only meaningful for the actual invoice */}
                {hasBilled && (
                  <dl className="rounded-lg bg-surface-secondary/50 divide-y divide-border-default text-xs">
                    <div className="flex justify-between px-3 py-1.5">
                      <dt className="text-foreground-muted">Freight</dt>
                      <dd className="text-foreground font-medium tabular-nums">{inr(tracking.freightCharge ?? 0)}</dd>
                    </div>
                    {tracking.codCharge != null && tracking.codCharge > 0 && (
                      <div className="flex justify-between px-3 py-1.5">
                        <dt className="text-foreground-muted">COD handling</dt>
                        <dd className="text-foreground font-medium tabular-nums">{inr(tracking.codCharge)}</dd>
                      </div>
                    )}
                    {tracking.odaCharge != null && tracking.odaCharge > 0 && (
                      <div className="flex justify-between px-3 py-1.5">
                        <dt className="text-foreground-muted">ODA surcharge</dt>
                        <dd className="text-foreground font-medium tabular-nums">{inr(tracking.odaCharge)}</dd>
                      </div>
                    )}
                    <div className="flex justify-between px-3 py-1.5">
                      <dt className="text-foreground font-semibold">Total billed</dt>
                      <dd className="text-foreground font-bold tabular-nums">{inr(tracking.billedAmount!)}</dd>
                    </div>
                  </dl>
                )}

                <p className="text-[10px] text-foreground-muted mt-2 leading-relaxed">
                  {hasBilled ? (
                    <>
                      Actual charges from Delhivery&apos;s invoice
                      {tracking.billedAt ? ` · billed ${new Date(tracking.billedAt).toLocaleDateString('en-IN')}` : ''}.
                    </>
                  ) : estExtra > 0 ? (
                    'Delhivery billed a higher weight than declared at pickup. Estimated extra is proportional — the actual invoice may differ.'
                  ) : (
                    'Final charge confirms once Delhivery raises the shipment invoice.'
                  )}
                </p>
              </div>
            )
          })()}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {showHistory && <ScanHistoryModal scans={tracking.scans} onClose={() => setShowHistory(false)} />}

      <HorizontalTimeline tracking={tracking} />

      <div className="flex flex-wrap items-start gap-3">
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusBadge(displayType)}`}>
          {statusLabel(displayType)}
        </span>
        <div className="text-sm text-foreground-secondary">
          AWB: <span className="font-mono text-foreground">{tracking.awb}</span>
        </div>
      </div>

      {tracking.status && (
        <p className="text-sm text-foreground leading-relaxed">{tracking.status.replace(/<br\s*\/?>/gi, ' ')}</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        {tracking.origin && (
          <div>
            <p className="text-foreground-secondary text-xs">Origin</p>
            <p className="text-foreground font-medium">{tracking.origin}</p>
          </div>
        )}
        {tracking.destination && (
          <div>
            <p className="text-foreground-secondary text-xs">Destination</p>
            <p className="text-foreground font-medium">{tracking.destination}</p>
          </div>
        )}
        {tracking.pickUpDate && (
          <div>
            <p className="text-foreground-secondary text-xs">Picked Up</p>
            <p className="text-foreground font-medium">{new Date(tracking.pickUpDate).toLocaleDateString('en-IN')}</p>
          </div>
        )}
        {tracking.expectedDelivery && (
          <div>
            <p className="text-foreground-secondary text-xs">Expected Delivery</p>
            <p className="text-foreground font-medium">
              {new Date(tracking.expectedDelivery).toLocaleDateString('en-IN')}
            </p>
          </div>
        )}
      </div>

      {tracking.scans?.length > 0 &&
        (() => {
          const latest = tracking.scans[0]
          return (
            <div className="flex items-center justify-between border-t border-border-default pt-3">
              <p className="text-xs text-foreground-secondary">
                Last update: {latest?.date ? new Date(latest.date).toLocaleString('en-IN') : '—'}
                {latest?.location ? ` · ${latest.location}` : ''}
              </p>
              <button
                onClick={() => setShowHistory(true)}
                className="text-sm text-accent-500 hover:text-accent-600 flex items-center gap-1 shrink-0"
              >
                View history ({tracking.scans.length})
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          )
        })()}
    </div>
  )
}

/**
 * Record Delhivery's revised charged weight.
 *
 * Delhivery reprices when the measured weight differs from what was declared, but does not
 * expose the revised weight to this account — Shipment.ChargedWeight is null on every AWB and
 * the discrepancy endpoints 404. The operator copies "Updated charged weight" off the Delhivery
 * shipment page; the cost is then computed from Delhivery's own rate API, not typed in, so the
 * figure matches their dashboard exactly.
 */
function RepriceCharge({
  orderId,
  apiBase,
  currentKg,
  currentAmount,
  onDone,
}: {
  orderId: string
  apiBase: string
  currentKg: number | null
  currentAmount: number | null
  onDone: () => void
}) {
  const [open, setOpen] = useState(false)
  const [kg, setKg] = useState(currentKg != null ? String(currentKg) : '')
  const [amount, setAmount] = useState(currentAmount != null ? String(currentAmount) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const kgVal = kg.trim() === '' ? null : Number(kg)
    const amtVal = amount.trim() === '' ? null : Number(amount)
    if (kgVal == null && amtVal == null) {
      setError('Enter the charged weight or the charged amount')
      return
    }
    if (kgVal != null && (!Number.isFinite(kgVal) || kgVal <= 0)) {
      setError('Weight must be a number in kg, e.g. 2.78')
      return
    }
    if (amtVal != null && (!Number.isFinite(amtVal) || amtVal < 0)) {
      setError('Amount must be a number, e.g. 162.70')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`${apiBase}/${orderId}/delivery-charge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chargedWeightKg: kgVal, chargedAmount: amtVal }),
      })
      const text = await res.text()
      let data: any = null
      try {
        data = JSON.parse(text)
      } catch {
        /* not JSON — surfaced below */
      }

      if (!res.ok || !data) {
        // A bare "could not save" hides whether this was a 404 (route not deployed), a 500, or
        // a real rejection. Show the status and whatever the server actually said.
        setError(
          data?.error ??
            `HTTP ${res.status} — ${
              text
                .slice(0, 120)
                .replace(/<[^>]*>/g, '')
                .trim() || 'no response body'
            }`
        )
        return
      }
      setOpen(false)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block mb-3 text-xs font-medium text-accent-600 dark:text-accent-400 hover:underline text-left"
      >
        {currentKg != null || currentAmount != null ? 'Update delivery charge' : 'Enter Delhivery charge'}
      </button>
    )
  }

  return (
    <div className="mb-3 rounded-lg border border-border-default bg-surface-secondary p-3">
      <p className="text-[11px] text-foreground-secondary mb-2">
        From the Delhivery shipment page. Enter the weight and the cost is calculated at Delhivery&apos;s own rates, or
        enter the amount directly if you have it — the amount wins.
      </p>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-foreground-muted">Charged weight (kg)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={kg}
            onChange={e => {
              setKg(e.target.value)
              setError(null)
            }}
            placeholder="2.78"
            className="w-28 px-2 py-1.5 text-sm rounded border border-border-default bg-surface text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wide text-foreground-muted">Charged amount (₹)</span>
          <input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={e => {
              setAmount(e.target.value)
              setError(null)
            }}
            placeholder="162.70"
            className="w-32 px-2 py-1.5 text-sm rounded border border-border-default bg-surface text-foreground"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-3 py-1.5 text-sm rounded-lg bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white font-medium"
        >
          {busy ? 'Pricing…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setError(null)
          }}
          className="px-3 py-1.5 text-sm rounded-lg border border-border-default text-foreground hover:bg-surface"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
