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

function statusBadge(type: string | null) {
  switch (type?.toUpperCase()) {
    case 'DL': return 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300'
    case 'OT': return 'bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300'
    case 'IT': return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300'
    case 'UD': return 'bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300'
    default:   return 'bg-surface-secondary text-foreground-secondary'
  }
}

function statusLabel(type: string | null) {
  switch (type?.toUpperCase()) {
    case 'DL': return 'Delivered'
    case 'OT': return 'Out for Delivery'
    case 'IT': return 'In Transit'
    case 'UD': return 'Undelivered'
    case 'PP': return 'Pickup Pending'
    case 'PU': return 'Picked Up'
    default:   return type || 'In Progress'
  }
}

export default function DelhiveryTracking({
  orderId,
  apiBase = '/api/orders',
}: {
  orderId: string
  apiBase?: string
}) {
  const [tracking, setTracking] = useState<TrackingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    fetch(`${apiBase}/${orderId}/track`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setTracking(d.tracking)
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

  const latestScan = tracking.scans?.[0]

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-3">
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusBadge(tracking.statusType)}`}>
          {statusLabel(tracking.statusType)}
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

      {tracking.scans?.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-sm text-accent-500 hover:text-accent-600 flex items-center gap-1 mt-1"
          >
            {expanded ? 'Hide' : 'Show'} scan history ({tracking.scans.length})
            <svg className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {expanded && (
            <div className="mt-2 space-y-0 border-l-2 border-border-default ml-2">
              {tracking.scans.map((scan, i) => (
                <div key={i} className="relative pl-4 pb-3">
                  <div className={`absolute -left-[5px] top-1.5 w-2 h-2 rounded-full ${i === 0 ? 'bg-accent-500' : 'bg-border-default'}`} />
                  <p className="text-xs text-foreground-muted">{scan.date ? new Date(scan.date).toLocaleString('en-IN') : '—'}</p>
                  <p className="text-sm text-foreground font-medium">{scan.activity || '—'}</p>
                  {scan.location && <p className="text-xs text-foreground-secondary">{scan.location}</p>}
                  {scan.instructions && <p className="text-xs text-foreground-muted italic">{scan.instructions}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {latestScan && !expanded && (
        <div className="text-xs text-foreground-secondary border-t border-border-default pt-2 mt-1">
          Last update: {latestScan.date ? new Date(latestScan.date).toLocaleString('en-IN') : '—'}
          {latestScan.location ? ` · ${latestScan.location}` : ''}
        </div>
      )}
    </div>
  )
}
