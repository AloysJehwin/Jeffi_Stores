'use client'

import CustomSelect from '@/components/visitor/CustomSelect'

export interface AddressFormData {
  address_type: string
  full_name: string
  address_line1: string
  address_line2: string
  landmark: string
  city: string
  state: string
  postal_code: string
  country: string
  phone: string
  is_default: boolean
}

interface AccountAddressFormProps {
  formData: AddressFormData
  setFormData: (data: AddressFormData) => void
  editing: boolean
  isSaving: boolean
  pinLookupState: 'idle' | 'loading' | 'found' | 'error'
  localities: string[]
  onPincodeChange: (value: string) => void
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
}

export default function AccountAddressForm({
  formData,
  setFormData,
  editing,
  isSaving,
  pinLookupState,
  localities,
  onPincodeChange,
  onSubmit,
  onCancel,
}: AccountAddressFormProps) {
  const pinLookupDone = pinLookupState === 'found'

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 mb-6">
      <h2 className="text-xl font-bold text-foreground mb-6">{editing ? 'Edit Address' : 'Add New Address'}</h2>
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <CustomSelect
            id="address_type"
            label="Address Type"
            value={formData.address_type}
            onChange={val => setFormData({ ...formData, address_type: val })}
            required
            options={[
              { value: 'shipping', label: 'Shipping' },
              { value: 'billing', label: 'Billing' },
              { value: 'both', label: 'Both' },
            ]}
          />
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-foreground-secondary mb-2">
              Full Name *
            </label>
            <input
              id="full_name"
              type="text"
              value={formData.full_name}
              onChange={e => setFormData({ ...formData, full_name: e.target.value })}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
              required
            />
          </div>
        </div>

        <div>
          <label htmlFor="phone" className="block text-sm font-medium text-foreground-secondary mb-2">
            Phone Number *
          </label>
          <div className="flex">
            <span className="inline-flex items-center px-4 py-2 border border-r-0 border-border-secondary rounded-l-lg bg-surface text-foreground-secondary text-sm font-medium">
              +91
            </span>
            <input
              id="phone"
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={formData.phone}
              onChange={e => setFormData({ ...formData, phone: e.target.value.replace(/\D/g, '') })}
              className="w-full px-4 py-2 border border-border-secondary rounded-r-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
              placeholder="00000 00000"
              required
            />
          </div>
          {formData.phone && formData.phone.length > 0 && formData.phone.length !== 10 && (
            <p className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</p>
          )}
        </div>

        <div>
          <label htmlFor="address_line1" className="block text-sm font-medium text-foreground-secondary mb-2">
            Address Line 1 *
          </label>
          <input
            id="address_line1"
            type="text"
            value={formData.address_line1}
            onChange={e => setFormData({ ...formData, address_line1: e.target.value })}
            className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
            placeholder="House/Flat No., Street, Area"
            required
          />
        </div>

        <div>
          <label htmlFor="postal_code" className="block text-sm font-medium text-foreground-secondary mb-2">
            PIN Code *
          </label>
          <div className="relative">
            <input
              id="postal_code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={formData.postal_code}
              onChange={e => onPincodeChange(e.target.value)}
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
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
              {pinLookupState === 'error' && (
                <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </div>
          </div>
          {pinLookupState === 'error' && (
            <p className="mt-1 text-xs text-red-500">PIN code not found. Please check and try again.</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="city" className="block text-sm font-medium text-foreground-secondary mb-2">
              City / District *
            </label>
            <input
              id="city"
              type="text"
              value={formData.city}
              readOnly={pinLookupDone}
              onChange={e => !pinLookupDone && setFormData({ ...formData, city: e.target.value })}
              className={`w-full px-4 py-2 border border-border-secondary rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                pinLookupDone ? 'bg-surface-secondary cursor-not-allowed' : 'bg-surface'
              }`}
              placeholder="Auto-filled from PIN"
              required
            />
          </div>
          <div>
            <label htmlFor="state" className="block text-sm font-medium text-foreground-secondary mb-2">
              State *
            </label>
            <input
              id="state"
              type="text"
              value={formData.state}
              readOnly={pinLookupDone}
              onChange={e => !pinLookupDone && setFormData({ ...formData, state: e.target.value })}
              className={`w-full px-4 py-2 border border-border-secondary rounded-lg text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500 ${
                pinLookupDone ? 'bg-surface-secondary cursor-not-allowed' : 'bg-surface'
              }`}
              placeholder="Auto-filled from PIN"
              required
            />
          </div>
        </div>

        {localities.length > 0 ? (
          <CustomSelect
            id="address_line2"
            label="Locality / Village"
            value={formData.address_line2}
            onChange={val => setFormData({ ...formData, address_line2: val })}
            placeholder="Select locality"
            options={localities.map(loc => ({ value: loc, label: loc }))}
          />
        ) : (
          <div>
            <label htmlFor="address_line2" className="block text-sm font-medium text-foreground-secondary mb-2">
              Locality / Village
            </label>
            <input
              id="address_line2"
              type="text"
              value={formData.address_line2}
              onChange={e => setFormData({ ...formData, address_line2: e.target.value })}
              className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
              placeholder="Area, Colony, Village"
            />
          </div>
        )}

        <div>
          <label htmlFor="landmark" className="block text-sm font-medium text-foreground-secondary mb-2">
            Landmark (Optional)
          </label>
          <input
            id="landmark"
            type="text"
            value={formData.landmark}
            onChange={e => setFormData({ ...formData, landmark: e.target.value })}
            className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
            placeholder="Nearby landmark"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="is_default"
            checked={formData.is_default}
            onChange={e => setFormData({ ...formData, is_default: e.target.checked })}
            className="w-4 h-4 text-accent-600 border-border-secondary rounded focus:ring-accent-500"
          />
          <label htmlFor="is_default" className="text-sm text-foreground-secondary">
            Set as default address
          </label>
        </div>

        <div className="flex gap-4">
          <button
            type="submit"
            disabled={isSaving}
            className="px-6 py-3 bg-accent-600 text-white rounded-lg hover:bg-accent-700 transition-colors font-semibold disabled:bg-accent-300 disabled:cursor-not-allowed flex items-center"
          >
            {isSaving ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></div>
                Saving...
              </>
            ) : editing ? (
              'Update Address'
            ) : (
              'Save Address'
            )}
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={onCancel}
            className="px-6 py-3 bg-surface-secondary text-foreground-secondary rounded-lg hover:bg-border-default transition-colors font-semibold disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
