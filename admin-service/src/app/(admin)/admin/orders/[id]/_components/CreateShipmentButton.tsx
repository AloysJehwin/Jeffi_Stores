'use client'

import { useState } from 'react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import AdminSelect from '@/components/admin/AdminSelect'
import { Check, Package, X } from 'lucide-react'
import { useActionToast } from '@/components/admin/kit/toast'
import { FormButton } from '@/components/admin/kit/form'

export default function CreateShipmentButton({ orderId, awbNumber }: { orderId: string; awbNumber?: string | null }) {
  const toast = useActionToast()
  const [loading, setLoading] = useState(false)
  const [awb, setAwb] = useState<string | null>(awbNumber || null)
  const [confirming, setConfirming] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelConfirming, setCancelConfirming] = useState(false)
  const [warehouses, setWarehouses] = useState<{ value: string; label: string }[]>([])
  const [pickupLocation, setPickupLocation] = useState('')

  const beginConfirm = async () => {
    setConfirming(true)
    try {
      const res = await fetch('/api/admin/delhivery/pickup-locations')
      const data = await res.json()
      const opts = (data.locations || []).map((l: { name: string }) => ({ value: l.name, label: l.name }))
      setWarehouses(opts)
      if (opts.length > 0 && !pickupLocation) setPickupLocation(opts[0].value)
    } catch {
      setWarehouses([])
    }
  }

  const handleCreate = async () => {
    setConfirming(false)
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/create-shipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pickupLocation ? { pickupLocation } : {}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.details || data.error || 'Failed to create shipment')
      setAwb(data.awb)
      toast.success(`Shipment registered. AWB ${data.awb}`)
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCancel = async () => {
    setCancelConfirming(false)
    setCancelling(true)
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/cancel-shipment`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.details || data.error || 'Failed to cancel shipment')
      setAwb(null)
      toast.success('Shipment cancelled.')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setCancelling(false)
    }
  }

  if (awb) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-3 rounded-lg border border-green-500/40 bg-green-500/5 px-4 py-3">
          <Check className="h-5 w-5 shrink-0 text-green-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Shipment registered</p>
            <p className="mt-0.5 font-mono text-xs text-foreground-muted">AWB: {awb}</p>
          </div>
        </div>
        {cancelConfirming ? (
          <RequireWrite scope="orders:write">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3">
              <p className="flex-1 text-sm text-foreground">Cancel this shipment with Delhivery? This cannot be undone once picked up.</p>
              <div className="flex shrink-0 gap-2">
                <button type="button" onClick={handleCancel} disabled={cancelling} className="control-sm bg-red-600 font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                  {cancelling ? 'Cancelling...' : 'Confirm Cancel'}
                </button>
                <button type="button" onClick={() => setCancelConfirming(false)} className="control-sm text-foreground-secondary hover:text-foreground">
                  Keep
                </button>
              </div>
            </div>
          </RequireWrite>
        ) : (
          <RequireWrite scope="orders:write">
            <button
              type="button"
              onClick={() => setCancelConfirming(true)}
              disabled={cancelling}
              className="control-md w-full justify-center border border-red-500/40 text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400 sm:w-auto"
            >
              <X className="h-4 w-4" />
              Cancel Shipment
            </button>
          </RequireWrite>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <RequireWrite scope="orders:write">
          <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
            <p className="text-sm text-foreground">Register with Delhivery and generate an AWB number?</p>
            {warehouses.length > 1 && (
              <label className="block space-y-1 text-xs font-medium text-foreground-secondary">
                <span>Pickup warehouse</span>
                <AdminSelect sm value={pickupLocation} options={warehouses} onChange={setPickupLocation} />
              </label>
            )}
            <div className="flex gap-2">
              <FormButton type="button" onClick={handleCreate} disabled={loading}>
                Confirm
              </FormButton>
              <FormButton type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </FormButton>
            </div>
          </div>
        </RequireWrite>
      ) : (
        <RequireWrite scope="orders:write">
          <button type="button" onClick={beginConfirm} disabled={loading} className="control-md w-full justify-center bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50 sm:w-auto">
            <Package className="h-4 w-4" />
            {loading ? 'Creating shipment...' : 'Create Delhivery Shipment'}
          </button>
        </RequireWrite>
      )}
    </div>
  )
}
