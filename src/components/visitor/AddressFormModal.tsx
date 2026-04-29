'use client'

import { useState, useEffect, useRef } from 'react'
import { useToast } from '@/contexts/ToastContext'
import CustomSelect from './CustomSelect'

interface Address {
  id: string
  address_type: string
  full_name: string
  address_line1: string
  address_line2?: string
  landmark?: string
  city: string
  state: string
  postal_code: string
  country: string
  phone: string
  is_default: boolean
}

interface AddressFormModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved: (address: Address) => void
  editAddress?: Address | null
}

export default function AddressFormModal({ isOpen, onClose, onSaved, editAddress }: AddressFormModalProps) {
  const { showToast } = useToast()
  const [isSaving, setIsSaving] = useState(false)
  const [pinLookupState, setPinLookupState] = useState<'idle' | 'loading' | 'found' | 'error'>('idle')
  const [localities, setLocalities] = useState<string[]>([])
  const pinDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [formData, setFormData] = useState({
    address_type: 'shipping',
    full_name: '',
    address_line1: '',
    address_line2: '',
    landmark: '',
    city: '',
    state: '',
    postal_code: '',
    country: 'India',
    phone: '',
    is_default: true,
  })

  useEffect(() => {
    if (editAddress) {
      setFormData({
        address_type: editAddress.address_type,
        full_name: editAddress.full_name,
        address_line1: editAddress.address_line1,
        address_line2: editAddress.address_line2 || '',
        landmark: editAddress.landmark || '',
        city: editAddress.city,
        state: editAddress.state,
        postal_code: editAddress.postal_code,
        country: editAddress.country,
        phone: (editAddress.phone || '').replace(/^\+91/, ''),
        is_default: editAddress.is_default,
      })
      setPinLookupState('found')
      setLocalities([])
    } else {
      setFormData({
        address_type: 'shipping',
        full_name: '',
        address_line1: '',
        address_line2: '',
        landmark: '',
        city: '',
        state: '',
        postal_code: '',
        country: 'India',
        phone: '',
        is_default: true,
      })
      setPinLookupState('idle')
      setLocalities([])
    }
  }, [editAddress, isOpen])

  const handlePincodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setFormData(prev => ({ ...prev, postal_code: digits, city: '', state: '', address_line2: '' }))
    setPinLookupState('idle')
    setLocalities([])

    if (pinDebounceRef.current) clearTimeout(pinDebounceRef.current)

    if (digits.length === 6) {
      setPinLookupState('loading')
      pinDebounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/pincode/${digits}`)
          if (res.ok) {
            const data = await res.json()
            setFormData(prev => ({ ...prev, city: data.district, state: data.state }))
            setLocalities(data.postOffices || [])
            setPinLookupState('found')
          } else {
            setPinLookupState('error')
          }
        } catch {
          setPinLookupState('error')
        }
      }, 400)
    }
  }

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.phone.length !== 10) {
      showToast('Enter a valid 10-digit mobile number', 'error')
      return
    }
    setIsSaving(true)
    try {
      const url = editAddress ? `/api/user/addresses/${editAddress.id}` : '/api/user/addresses'
      const method = editAddress ? 'PATCH' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        const data = await response.json()
        showToast(editAddress ? 'Address updated' : 'Address saved', 'success')
        onSaved(data.address)
      } else {
        const data = await response.json()
        showToast(data.error || 'Failed to save address', 'error')
      }
    } catch {
      showToast('Failed to save address', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const pinLookupDone = pinLookupState === 'found'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/30">
      <div className="bg-surface-elevated rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto animate-fade-in">
        <div className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground">
              {editAddress ? 'Edit Address' : 'Add Delivery Address'}
            </h3>
            <button
              onClick={onClose}
              className="p-1 text-foreground-muted hover:text-foreground transition-colors"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <CustomSelect
                id="modal_address_type"
                label="Address Type"
                value={formData.address_type}
                onChange={(val) => setFormData({ ...formData, address_type: val })}
                required
                options={[
                  { value: 'shipping', label: 'Shipping' },
                  { value: 'billing', label: 'Billing' },
                  { value: 'both', label: 'Both' },
                ]}
              />
              <div>
                <label htmlFor="modal_full_name" className="block text-sm font-medium text-foreground-secondary mb-2">
                  Full Name *
                </label>
                <input
                  id="modal_full_name"
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="modal_phone" className="block text-sm font-medium text-foreground-secondary mb-2">
                Phone Number *
              </label>
              <div className="flex">
                <span className="inline-flex items-center px-4 py-2 border border-r-0 border-border-secondary rounded-l-lg bg-surface text-foreground-secondary text-sm font-medium">
                  +91
                </span>
                <input
                  id="modal_phone"
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
                  className="w-full px-4 py-2 border border-border-secondary rounded-r-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                  placeholder="98765 43210"
                  required
                />
              </div>
              {formData.phone && formData.phone.length > 0 && formData.phone.length !== 10 && (
                <p className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</p>
              )}
            </div>

            <div>
              <label htmlFor="modal_address_line1" className="block text-sm font-medium text-foreground-secondary mb-2">
                Address Line 1 *
              </label>
              <input
                id="modal_address_line1"
                type="text"
                value={formData.address_line1}
                onChange={(e) => setFormData({ ...formData, address_line1: e.target.value })}
                className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                placeholder="House/Flat No., Street, Area"
                required
              />
            </div>

            <div>
              <label htmlFor="modal_postal_code" className="block text-sm font-medium text-foreground-secondary mb-2">
                PIN Code *
              </label>
              <div className="relative">
                <input
                  id="modal_postal_code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={formData.postal_code}
                  onChange={(e) => handlePincodeChange(e.target.value)}
                  className="w-full px-4 py-2 pr-10 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                  placeholder="6-digit PIN code"
                  required
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {pinLookupState === 'loading' && (
                    <div className="animate-spin w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full" />
                  )}
                  {pinLookupState === 'found' && (
                    <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  )}
                  {pinLookupState === 'error' && (
                    <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                    </svg>
                  )}
                </div>
              </div>
              {pinLookupState === 'error' && (
                <p className="mt-1 text-xs text-red-500">PIN code not found. Please check and try again.</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="modal_city" className="block text-sm font-medium text-foreground-secondary mb-2">
                  City / District *
                </label>
                <input
                  id="modal_city"
                  type="text"
                  value={formData.city}
                  readOnly={pinLookupDone}
                  onChange={(e) => !pinLookupDone && setFormData({ ...formData, city: e.target.value })}
                  className={`w-full px-4 py-2 border border-border-secondary rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                    pinLookupDone ? 'bg-surface-secondary cursor-not-allowed' : 'bg-surface'
                  }`}
                  placeholder="Auto-filled from PIN"
                  required
                />
              </div>
              <div>
                <label htmlFor="modal_state" className="block text-sm font-medium text-foreground-secondary mb-2">
                  State *
                </label>
                <input
                  id="modal_state"
                  type="text"
                  value={formData.state}
                  readOnly={pinLookupDone}
                  onChange={(e) => !pinLookupDone && setFormData({ ...formData, state: e.target.value })}
                  className={`w-full px-4 py-2 border border-border-secondary rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                    pinLookupDone ? 'bg-surface-secondary cursor-not-allowed' : 'bg-surface'
                  }`}
                  placeholder="Auto-filled from PIN"
                  required
                />
              </div>
            </div>

            <div>
              <label htmlFor="modal_address_line2" className="block text-sm font-medium text-foreground-secondary mb-2">
                Locality / Village
              </label>
              {localities.length > 0 ? (
                <div className="flex gap-2">
                  <select
                    id="modal_address_line2"
                    value={formData.address_line2}
                    onChange={(e) => setFormData({ ...formData, address_line2: e.target.value })}
                    className="flex-1 px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground focus:outline-none focus:ring-2 focus:ring-accent-500"
                  >
                    <option value="">Select locality</option>
                    {localities.map((loc) => (
                      <option key={loc} value={loc}>{loc}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <input
                  id="modal_address_line2"
                  type="text"
                  value={formData.address_line2}
                  onChange={(e) => setFormData({ ...formData, address_line2: e.target.value })}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                  placeholder="Area, Colony, Village"
                />
              )}
            </div>

            <div>
              <label htmlFor="modal_landmark" className="block text-sm font-medium text-foreground-secondary mb-2">
                Landmark
              </label>
              <input
                id="modal_landmark"
                type="text"
                value={formData.landmark}
                onChange={(e) => setFormData({ ...formData, landmark: e.target.value })}
                className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                placeholder="Nearby landmark"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="modal_is_default"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="w-4 h-4 text-accent-600 border-border-secondary rounded focus:ring-accent-500"
              />
              <label htmlFor="modal_is_default" className="text-sm text-foreground-secondary">
                Set as default address
              </label>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-5 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
              >
                {isSaving ? (
                  <>
                    <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                    Saving...
                  </>
                ) : (
                  editAddress ? 'Update Address' : 'Save Address'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
