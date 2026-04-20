'use client'

import { useState, useEffect } from 'react'
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
    }
  }, [editAddress, isOpen])

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
    } catch (error) {
      showToast('Failed to save address', 'error')
    } finally {
      setIsSaving(false)
    }
  }

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
                placeholder="Street address, P.O. box"
                required
              />
            </div>

            <div>
              <label htmlFor="modal_address_line2" className="block text-sm font-medium text-foreground-secondary mb-2">
                Address Line 2
              </label>
              <input
                id="modal_address_line2"
                type="text"
                value={formData.address_line2}
                onChange={(e) => setFormData({ ...formData, address_line2: e.target.value })}
                className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                placeholder="Apartment, suite, unit, building, floor"
              />
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label htmlFor="modal_city" className="block text-sm font-medium text-foreground-secondary mb-2">
                  City *
                </label>
                <input
                  id="modal_city"
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
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
                  onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                  required
                />
              </div>
              <div>
                <label htmlFor="modal_postal_code" className="block text-sm font-medium text-foreground-secondary mb-2">
                  PIN Code *
                </label>
                <input
                  id="modal_postal_code"
                  type="text"
                  value={formData.postal_code}
                  onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
                  className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                  required
                />
              </div>
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
