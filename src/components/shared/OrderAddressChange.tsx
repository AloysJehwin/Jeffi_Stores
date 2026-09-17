'use client'

import { useEffect, useState } from 'react'
import AddressFormModal from '@/components/visitor/AddressFormModal'

interface AddressLike {
  full_name: string
  address_line1: string
  address_line2?: string | null
  landmark?: string | null
  city: string
  state: string
  postal_code: string
  phone: string
}

interface SavedAddress extends AddressLike {
  id: string
  address_type: string
  country: string
  is_default: boolean
}

export interface AddressChangeInfo {
  id: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  newAddress: AddressLike
  adminNotes: string | null
  createdAt: string
  reviewedAt: string | null
}

interface Props {
  orderId: string
  canChange: boolean
  request: AddressChangeInfo | null
  currentAddress: AddressLike | null
  portalHeader?: string
  onChanged: () => void
}

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
const MATCH_FIELDS: (keyof AddressLike)[] = ['full_name', 'address_line1', 'address_line2', 'landmark', 'city', 'state', 'postal_code', 'phone']
const isSame = (a: AddressLike, b: AddressLike | null) => !!b && MATCH_FIELDS.every(f => norm(a[f]) === norm(b[f]))

function AddressLines({ a }: { a: AddressLike }) {
  return (
    <>
      <p className="font-semibold text-foreground">{a.full_name}</p>
      <p className="text-sm">{a.address_line1}{a.address_line2 ? `, ${a.address_line2}` : ''}</p>
      {a.landmark && <p className="text-sm">Landmark: {a.landmark}</p>}
      <p className="text-sm">{a.city}, {a.state} {a.postal_code}</p>
      <p className="text-sm">Phone: {a.phone}</p>
    </>
  )
}

export default function OrderAddressChange({ orderId, canChange, request, currentAddress, portalHeader, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addresses, setAddresses] = useState<SavedAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const portalHeaders: Record<string, string> = portalHeader ? { 'X-Auth-Portal': portalHeader } : {}
  const pending = request?.status === 'pending'

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelectedId(null)
    fetch('/api/user/addresses', { credentials: 'include', headers: portalHeaders })
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Could not load your saved addresses')
        if (!cancelled) setAddresses(data.addresses || [])
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = async () => {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/address-change`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...portalHeaders },
        body: JSON.stringify({ addressId: selectedId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not submit your request')
      setOpen(false)
      onChanged()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/orders/${orderId}/address-change`, {
        method: 'DELETE',
        credentials: 'include',
        headers: portalHeaders,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Could not withdraw your request')
      onChanged()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  if (!pending && !canChange) return null

  return (
    <div className="mt-4 pt-4 border-t border-border-default">
      {pending && request ? (
        <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-300">Address change requested</p>
          <p className="text-xs text-amber-800 dark:text-amber-300/90 mt-0.5 mb-2">
            Waiting for the store to approve. Your order ships to the new address only after approval.
          </p>
          <div className="text-foreground-secondary"><AddressLines a={request.newAddress} /></div>
          {canChange && (
            <button
              type="button"
              onClick={withdraw}
              disabled={busy}
              className="mt-3 text-sm font-medium text-amber-900 dark:text-amber-300 underline disabled:opacity-50"
            >
              {busy ? 'Withdrawing...' : 'Withdraw request'}
            </button>
          )}
        </div>
      ) : (
        <>
          {request?.status === 'rejected' && (
            <p className="text-sm text-red-700 dark:text-red-400 mb-3">
              Your address change request was declined{request.adminNotes ? `: ${request.adminNotes}` : '.'}
            </p>
          )}
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="text-sm font-medium text-accent-600 hover:text-accent-700"
          >
            Change delivery address
          </button>
        </>
      )}
      {error && !open && <p className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</p>}

      {open && !showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/30 animate-fade-in">
          <div className="bg-surface-elevated rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-fade-in">
            <div className="p-4 sm:p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-lg font-bold text-foreground">Change Delivery Address</h3>
                <button onClick={() => setOpen(false)} aria-label="Close" className="p-1 text-foreground-muted hover:text-foreground transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-foreground-secondary mb-4">
                Pick one of your saved addresses. The store reviews the request, and the address changes only after it is approved.
              </p>

              {loading ? (
                <div className="flex justify-center py-10">
                  <div className="animate-spin w-6 h-6 border-2 border-accent-500 border-t-transparent rounded-full" />
                </div>
              ) : addresses.length === 0 ? (
                <p className="text-foreground-secondary text-sm text-center py-6">No saved addresses found.</p>
              ) : (
                <div className="space-y-3">
                  {addresses.map(address => {
                    const current = isSame(address, currentAddress)
                    return (
                      <label
                        key={address.id}
                        className={`flex items-start gap-4 p-4 border-2 rounded-lg transition-all ${
                          current
                            ? 'border-border-default opacity-60 cursor-not-allowed'
                            : selectedId === address.id
                              ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30 cursor-pointer'
                              : 'border-border-default hover:border-border-secondary cursor-pointer'
                        }`}
                      >
                        <input
                          type="radio"
                          name="order-address-change"
                          disabled={current}
                          checked={selectedId === address.id}
                          onChange={() => setSelectedId(address.id)}
                          className="mt-1 w-4 h-4 text-accent-600 focus:ring-accent-500"
                        />
                        <div className="flex-1 text-foreground-secondary">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {current && (
                              <span className="text-xs bg-surface-secondary text-foreground-secondary px-2 py-0.5 rounded">Current delivery address</span>
                            )}
                            {address.is_default && (
                              <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-2 py-0.5 rounded">Default</span>
                            )}
                            <span className="text-xs bg-surface-secondary text-foreground-secondary px-2 py-0.5 rounded capitalize">{address.address_type}</span>
                          </div>
                          <AddressLines a={address} />
                        </div>
                      </label>
                    )
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={() => setShowAddForm(true)}
                className="mt-4 text-sm font-medium text-accent-600 hover:text-accent-700"
              >
                + Add new address
              </button>

              {error && <p className="text-sm text-red-600 dark:text-red-400 mt-3">{error}</p>}

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={submit}
                  disabled={!selectedId || busy}
                  className="flex-1 bg-accent-500 hover:bg-accent-600 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {busy ? 'Submitting...' : 'Request Change'}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  className="px-4 py-2 rounded-lg font-medium border border-border-secondary text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <AddressFormModal
        isOpen={showAddForm}
        onClose={() => setShowAddForm(false)}
        onSaved={(address) => {
          setAddresses(prev => [address as SavedAddress, ...prev.filter(a => a.id !== address.id)])
          setSelectedId(address.id)
          setShowAddForm(false)
        }}
        portalHeader={portalHeader}
      />
    </div>
  )
}
