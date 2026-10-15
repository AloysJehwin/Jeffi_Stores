'use client'

import { useState } from 'react'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

type PickupStatus = 'pending' | 'picked_up' | 'failed'

interface PickupRequest {
  id: string
  pickup_id: string | null
  pickup_date: string
  awb_count: number
  awbs: string[]
  raw_response: Record<string, unknown> | null
  pickup_status: PickupStatus
  created_at: string
}

interface Props {
  requests: PickupRequest[]
  canWrite: boolean
  statusStyles: Record<PickupStatus, string>
  statusOptions: { value: PickupStatus; label: string }[]
  downloadingId: string | null
  refreshingId: string | null
  updatingId: string | null
  onDownloadLabels: (req: PickupRequest) => void | Promise<void>
  onRefresh: (req: PickupRequest) => void | Promise<void>
  onStatusChange: (req: PickupRequest, status: PickupStatus) => void | Promise<void>
}

function pickupDate(s: string) {
  return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function requestedAt(s: string) {
  return new Date(s).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  })
}

export default function PickupHistoryMobileList({
  requests,
  canWrite,
  statusStyles,
  statusOptions,
  downloadingId,
  refreshingId,
  updatingId,
  onDownloadLabels,
  onRefresh,
  onStatusChange,
}: Props) {
  const [active, setActive] = useState<PickupRequest | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  function buildActions(req: PickupRequest): MobileAction[] {
    const actions: MobileAction[] = []
    if ((req.awbs ?? []).length > 0) {
      actions.push({
        key: 'labels',
        label: downloadingId === req.id ? 'Generating labels...' : 'Download labels',
        disabled: downloadingId === req.id,
        onSelect: () => onDownloadLabels(req),
      })
    }
    if (req.pickup_status === 'pending') {
      actions.push({
        key: 'refresh',
        label: refreshingId === req.id ? 'Refreshing...' : 'Refresh status',
        disabled: refreshingId === req.id,
        onSelect: () => onRefresh(req),
      })
    }
    if (canWrite && req.pickup_status !== 'picked_up') {
      for (const opt of statusOptions) {
        if (opt.value === req.pickup_status) continue
        actions.push({
          key: `status-${opt.value}`,
          label: `Mark ${opt.label}`,
          disabled: updatingId === req.id,
          onSelect: () => {
            setActive(null)
            onStatusChange(req, opt.value)
          },
        })
      }
    }
    return actions
  }

  return (
    <>
      {requests.map(req => {
        const status = req.pickup_status || 'pending'
        return (
          <MobileListCard
            key={req.id}
            ariaLabel={`Open pickup ${req.pickup_id ?? req.id.slice(0, 8)}`}
            onTap={() => setActive(req)}
          >
            <div className="min-w-0 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground text-sm">{pickupDate(req.pickup_date)}</span>
                <span
                  className={`shrink-0 whitespace-nowrap px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusStyles[status] ?? statusStyles.pending}`}
                >
                  {status.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 text-xs text-foreground-secondary">
                <span className="font-mono truncate">{req.pickup_id ?? '-'}</span>
                <span className="shrink-0">{req.awb_count} AWB</span>
              </div>
              <div className="text-xs text-foreground-muted">{requestedAt(req.created_at)}</div>
            </div>
          </MobileListCard>
        )
      })}

      <MobileDetailSheet
        open={!!active}
        onClose={() => setActive(null)}
        title={active ? `Pickup ${active.pickup_id ?? active.id.slice(0, 8)}` : ''}
        subtitle={active ? pickupDate(active.pickup_date) : undefined}
        footer={
          active && buildActions(active).length > 0 ? (
            <button
              type="button"
              onClick={() => setActionsOpen(true)}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
            >
              Actions
            </button>
          ) : undefined
        }
      >
        {active && (
          <div className="px-5 py-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Status</span>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusStyles[active.pickup_status] ?? statusStyles.pending}`}
              >
                {(active.pickup_status || 'pending').replace('_', ' ')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-foreground-secondary">Requested</span>
              <span className="text-foreground">{requestedAt(active.created_at)}</span>
            </div>
            <div className="border-t border-border-default pt-3">
              <p className="text-xs text-foreground-muted uppercase tracking-wide mb-1.5">AWBs ({active.awb_count})</p>
              <div className="flex flex-wrap gap-1">
                {(active.awbs ?? []).map(awb => (
                  <span key={awb} className="px-1.5 py-0.5 rounded bg-surface-secondary font-mono text-xs text-foreground">
                    {awb}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!active}
        onClose={() => setActionsOpen(false)}
        title={active ? `Pickup ${active.pickup_id ?? active.id.slice(0, 8)}` : undefined}
        actions={active ? buildActions(active) : []}
      />
    </>
  )
}
