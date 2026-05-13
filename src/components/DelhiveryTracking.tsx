'use client'

import { useEffect, useState } from 'react'

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
  statusDateTime: string | null
  pickUpDate: string | null
  expectedDelivery: string | null
  origin: string | null
  destination: string | null
  scans: Scan[]
}

const EXCEPTION_TYPES = new Set(['UD', 'NDR', 'HOLD', 'LOST', 'MIS'])

function resolveDisplayType(statusType: string | null, scans: Scan[]): string | null {
  const type = statusType?.toUpperCase() ?? ''
  if (!EXCEPTION_TYPES.has(type)) return statusType

  for (let i = scans.length - 1; i >= 0; i--) {
    const activity = (scans[i]?.activity ?? '').toLowerCase()
    if (activity.includes('out for delivery')) return 'OD'
    if (activity.includes('rto delivered') || activity.includes('return delivered') || activity.includes('returned to origin')) return 'RTO-DL'
    if (activity.includes('out for return')) return 'RTO-OT'
    if (activity.includes('return in transit') || activity.includes('in return transit')) return 'RTO-IT'
    if (activity.includes('rto initiated') || activity.includes('return initiated')) return 'RTO'
    if (activity.includes('in transit') || activity === 'transit') return 'IT'
    if (activity.includes('picked up') || activity.includes('shipment picked')) return 'PU'
    if (activity.includes('delivered')) return 'DL'
  }
  return statusType
}

function statusBadge(type: string | null) {
  switch (type?.toUpperCase()) {
    case 'DL':     return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    case 'OT':
    case 'OD':     return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'IT':
    case 'PU':     return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
    case 'UD':
    case 'NDR':    return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    case 'RTO':
    case 'RTO-IT':
    case 'RTO-OT':
    case 'RTO-DL': return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    case 'HOLD':
    case 'MIS':
    case 'LOST':   return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
    default:       return 'bg-surface-secondary text-foreground-secondary'
  }
}

function statusLabel(type: string | null) {
  switch (type?.toUpperCase()) {
    case 'PP':     return 'Pickup Pending'
    case 'PU':     return 'Picked Up'
    case 'IT':     return 'In Transit'
    case 'OT':
    case 'OD':     return 'Out for Delivery'
    case 'DL':     return 'Delivered'
    case 'UD':     return 'Delivery Attempted'
    case 'NDR':    return 'Delivery Attempted'
    case 'RTO':    return 'Return Initiated'
    case 'RTO-IT': return 'Returning to Origin'
    case 'RTO-OT': return 'Out for Return'
    case 'RTO-DL': return 'Returned to Origin'
    case 'HOLD':   return 'On Hold'
    case 'MIS':    return 'Misrouted'
    case 'LOST':   return 'Lost'
    default:       return type || 'In Progress'
  }
}

const TIMELINE_STEPS: { key: string; label: string }[] = [
  { key: 'manifested', label: 'Order Dispatched' },
  { key: 'picked_up',  label: 'Picked Up'  },
  { key: 'in_transit', label: 'In Transit'  },
  { key: 'out',        label: 'Out for Delivery' },
  { key: 'delivered',  label: 'Delivered'   },
]

function resolveStep(scans: Scan[], statusType: string | null): number {
  const type = resolveDisplayType(statusType, scans)?.toUpperCase() ?? ''
  if (type === 'DL') return 4
  if (type === 'OT' || type === 'OD') return 3
  if (type === 'IT') return 2
  if (type === 'PU') return 1

  const activities = scans.map(s => s.activity?.toLowerCase() ?? '')
  if (activities.some(a => a.includes('deliver'))) return 4
  if (activities.some(a => a.includes('out for'))) return 3
  if (activities.some(a => a.includes('transit') || a.includes('in transit'))) return 2
  if (activities.some(a => a.includes('picked') || a.includes('pickup'))) return 1
  return 0
}

function HorizontalTimeline({ tracking }: { tracking: TrackingData }) {
  const activeStep = resolveStep(tracking.scans, tracking.statusType)

  return (
    <div className="w-full overflow-x-auto pb-1">
      <div className="flex items-start min-w-[480px]">
        {TIMELINE_STEPS.map((step, i) => {
          const done = i < activeStep
          const current = i === activeStep
          return (
            <div key={step.key} className="flex-1 flex flex-col items-center relative">
              {i > 0 && (
                <div className={`absolute left-0 top-3.5 h-0.5 w-1/2 ${done || current ? 'bg-accent-500' : 'bg-border-default'}`} />
              )}
              {i < TIMELINE_STEPS.length - 1 && (
                <div className={`absolute right-0 top-3.5 h-0.5 w-1/2 ${done ? 'bg-accent-500' : 'bg-border-default'}`} />
              )}
              <div className={`relative z-10 w-7 h-7 rounded-full border-2 flex items-center justify-center transition-colors ${
                done    ? 'bg-accent-500 border-accent-500' :
                current ? 'bg-white dark:bg-surface-elevated border-accent-500' :
                          'bg-surface border-border-default'
              }`}>
                {done ? (
                  <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <div className={`w-2.5 h-2.5 rounded-full ${current ? 'bg-accent-500' : 'bg-border-default'}`} />
                )}
              </div>
              <p className={`mt-2 text-xs text-center leading-tight px-1 ${
                current ? 'text-accent-500 font-semibold' :
                done    ? 'text-foreground font-medium' :
                          'text-foreground-muted'
              }`}>
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
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
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
                <div className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${i === 0 ? 'bg-accent-500' : 'bg-border-default'}`} />
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
}: {
  orderId: string
  apiBase?: string
  variant?: 'default' | 'admin'
  trackPath?: string
}) {
  const [tracking, setTracking] = useState<TrackingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [statusSynced, setStatusSynced] = useState<string | null>(null)

  useEffect(() => {
    fetch(`${apiBase}/${orderId}/${trackPath}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else {
          setTracking(d.tracking)
          if (d.statusSynced && d.syncedTo) setStatusSynced(d.syncedTo)
        }
      })
      .catch(() => setError('Could not load tracking'))
      .finally(() => setLoading(false))
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
    return (
      <p className="text-sm text-foreground-muted py-1">
        {error || 'Tracking information not yet available.'}
      </p>
    )
  }

  const displayType = resolveDisplayType(tracking.statusType, tracking.scans)
  const latestScan = tracking.scans?.[0]
  const isException = ['RTO', 'RTO-IT', 'RTO-OT', 'RTO-DL', 'UD', 'NDR', 'HOLD', 'LOST', 'MIS'].includes(tracking.statusType?.toUpperCase() ?? '')

  if (variant === 'admin') {
    return (
      <div className="space-y-5">
        {showHistory && <ScanHistoryModal scans={tracking.scans} onClose={() => setShowHistory(false)} />}

        {statusSynced && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-xs text-green-800 dark:text-green-300">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            Order status automatically updated to <span className="font-semibold capitalize">{statusSynced}</span> based on Delhivery tracking.
          </div>
        )}
        {isException && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-800 dark:text-red-300">
            <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Shipment exception: <span className="font-semibold">{statusLabel(tracking.statusType)}</span>
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
              Picked up: <span className="text-foreground">{new Date(tracking.pickUpDate).toLocaleDateString('en-IN')}</span>
            </span>
          )}
          {tracking.expectedDelivery && (
            <span className="text-foreground-secondary">
              EDD: <span className="text-foreground">{new Date(tracking.expectedDelivery).toLocaleDateString('en-IN')}</span>
            </span>
          )}
        </div>

        {tracking.scans?.length > 0 && (
          <div className="flex items-center justify-between pt-1">
            <p className="text-xs text-foreground-secondary">
              Last update: {latestScan?.date ? new Date(latestScan.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—'}
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
        <p className="text-sm text-foreground leading-relaxed"
           dangerouslySetInnerHTML={{ __html: tracking.status.replace(/<br\s*\/?>/gi, ' ') }} />
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
            <p className="text-foreground font-medium">{new Date(tracking.expectedDelivery).toLocaleDateString('en-IN')}</p>
          </div>
        )}
      </div>

      {tracking.scans?.length > 0 && (() => {
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
