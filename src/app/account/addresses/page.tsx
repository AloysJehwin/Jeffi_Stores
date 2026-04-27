'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useRouter, usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import AccountSidebar, { navItems } from '@/components/visitor/AccountSidebar'
import CustomSelect from '@/components/visitor/CustomSelect'

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

export default function AddressesPage() {
  const { user, isLoading } = useAuth()
  const { showToast, showConfirm } = useToast()
  const router = useRouter()
  const pathname = usePathname()
  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingAddress, setEditingAddress] = useState<Address | null>(null)
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
    is_default: false,
  })

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login?redirect=/account/addresses')
    }
    if (user) {
      fetchAddresses()
    }
  }, [user, isLoading, router])

  const fetchAddresses = async () => {
    try {
      const response = await fetch('/api/user/addresses')
      if (response.ok) {
        const data = await response.json()
        setAddresses(data.addresses || [])
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.phone.length !== 10) {
      showToast('Enter a valid 10-digit mobile number', 'error')
      return
    }
    setIsSaving(true)
    try {
      const url = editingAddress ? `/api/user/addresses/${editingAddress.id}` : '/api/user/addresses'
      const method = editingAddress ? 'PATCH' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        await fetchAddresses()
        setShowForm(false)
        setEditingAddress(null)
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
          is_default: false,
        })
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

  const handleEdit = (address: Address) => {
    setEditingAddress(address)
    setFormData({
      address_type: address.address_type,
      full_name: address.full_name,
      address_line1: address.address_line1,
      address_line2: address.address_line2 || '',
      landmark: address.landmark || '',
      city: address.city,
      state: address.state,
      postal_code: address.postal_code,
      country: address.country,
      phone: (address.phone || '').replace(/^\+91/, ''),
      is_default: address.is_default,
    })
    setShowForm(true)
  }

  const handleDelete = async (addressId: string) => {
    showConfirm({
      title: 'Delete Address',
      message: 'Are you sure you want to delete this address? This action cannot be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      type: 'danger',
      onConfirm: async () => {
        try {
          const response = await fetch(`/api/user/addresses/${addressId}`, {
            method: 'DELETE',
          })

          if (response.ok) {
            await fetchAddresses()
            showToast('Address deleted successfully', 'success')
          } else {
            const data = await response.json()

            if (data.code === 'ADDRESS_IN_USE') {
              showToast(data.error, 'warning')
            } else {
              showToast('Failed to delete address', 'error')
            }
          }
        } catch (error) {
          showToast('Failed to delete address', 'error')
        }
      },
    })
  }

  if (isLoading || loading) {
    return (
      <div className="container mx-auto px-4 py-16">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full mx-auto"></div>
          <p className="mt-4 text-foreground-secondary">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="bg-surface min-h-screen">

      {/* Mobile header */}
      <div className="lg:hidden bg-accent-500 pt-8 pb-16 px-4">
        <h1 className="text-lg font-semibold text-white/80 mb-4">My Account</h1>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-white/20 flex items-center justify-center text-2xl font-bold text-white flex-shrink-0">
            {user.firstName?.[0]?.toUpperCase() || 'U'}
          </div>
          <div>
            <p className="text-xl font-bold text-white">{user.firstName} {user.lastName}</p>
            <p className="text-sm text-white/70 mt-0.5">{user.email}</p>
          </div>
        </div>
      </div>

      {/* Mobile nav tabs */}
      <div className="lg:hidden relative z-10 mx-4 -mt-8 mb-4">
        <div className="bg-surface-elevated rounded-xl shadow-md border border-border-default overflow-hidden">
          <div className="flex">
            {navItems.map((item) => {
              const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex-1 flex flex-col items-center gap-1 py-3 text-xs font-medium transition-colors border-b-2 ${
                    isActive
                      ? 'text-accent-600 border-accent-500 dark:text-accent-400'
                      : 'text-foreground-muted border-transparent'
                  }`}
                >
                  <span className={isActive ? 'text-accent-500' : 'text-foreground-muted'}>{item.icon}</span>
                  <span className="leading-tight text-center" style={{ fontSize: '10px' }}>{item.label}</span>
                </Link>
              )
            })}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 py-4 pb-16 lg:py-8 lg:pb-8">
        <div className="hidden lg:block mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-foreground">My Addresses</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 sm:gap-6">
          {/* Sidebar */}
          <div className="hidden lg:block lg:col-span-1">
            <AccountSidebar />
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            <div className="mb-6">
              <button
                type="button"
                onClick={() => {
                  setEditingAddress(null)
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
                    is_default: false,
                  })
                  setShowForm(!showForm)
                }}
                className="px-6 py-3 bg-accent-600 text-white rounded-lg hover:bg-accent-700 transition-colors font-semibold"
              >
                {showForm ? 'Cancel' : '+ Add New Address'}
              </button>
            </div>

            {showForm && (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 mb-6">
                <h2 className="text-xl font-bold text-foreground mb-6">
                  {editingAddress ? 'Edit Address' : 'Add New Address'}
                </h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <CustomSelect
                      id="address_type"
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
                      <label htmlFor="full_name" className="block text-sm font-medium text-foreground-secondary mb-2">
                        Full Name
                      </label>
                      <input
                        id="full_name"
                        type="text"
                        value={formData.full_name}
                        onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
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
                    <label htmlFor="address_line1" className="block text-sm font-medium text-foreground-secondary mb-2">
                      Address Line 1
                    </label>
                    <input
                      id="address_line1"
                      type="text"
                      value={formData.address_line1}
                      onChange={(e) => setFormData({ ...formData, address_line1: e.target.value })}
                      className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                      placeholder="Street address, P.O. box"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="address_line2" className="block text-sm font-medium text-foreground-secondary mb-2">
                      Address Line 2 (Optional)
                    </label>
                    <input
                      id="address_line2"
                      type="text"
                      value={formData.address_line2}
                      onChange={(e) => setFormData({ ...formData, address_line2: e.target.value })}
                      className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                      placeholder="Apartment, suite, unit, building, floor, etc."
                    />
                  </div>

                  <div>
                    <label htmlFor="landmark" className="block text-sm font-medium text-foreground-secondary mb-2">
                      Landmark (Optional)
                    </label>
                    <input
                      id="landmark"
                      type="text"
                      value={formData.landmark}
                      onChange={(e) => setFormData({ ...formData, landmark: e.target.value })}
                      className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                      placeholder="Nearby landmark"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label htmlFor="city" className="block text-sm font-medium text-foreground-secondary mb-2">
                        City
                      </label>
                      <input
                        id="city"
                        type="text"
                        value={formData.city}
                        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                        className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="state" className="block text-sm font-medium text-foreground-secondary mb-2">
                        State
                      </label>
                      <input
                        id="state"
                        type="text"
                        value={formData.state}
                        onChange={(e) => setFormData({ ...formData, state: e.target.value })}
                        className="w-full px-4 py-2 border border-border-secondary rounded-lg bg-surface text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-accent-500"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="postal_code" className="block text-sm font-medium text-foreground-secondary mb-2">
                        Postal Code
                      </label>
                      <input
                        id="postal_code"
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
                      id="is_default"
                      checked={formData.is_default}
                      onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
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
                      ) : (
                        editingAddress ? 'Update Address' : 'Save Address'
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => {
                        setShowForm(false)
                        setEditingAddress(null)
                      }}
                      className="px-6 py-3 bg-surface-secondary text-foreground-secondary rounded-lg hover:bg-border-default transition-colors font-semibold disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            )}

            {addresses.length === 0 ? (
              <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-12 text-center">
                <svg
                  className="w-16 h-16 text-foreground-muted mx-auto mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                <h3 className="text-xl font-semibold text-foreground mb-2">No addresses saved</h3>
                <p className="text-foreground-secondary">Add an address to make checkout faster.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {addresses.map((address) => (
                  <div
                    key={address.id}
                    className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-4 sm:p-6 relative"
                  >
                    {address.is_default && (
                      <span className="absolute top-4 right-4 px-3 py-1 bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 text-xs font-semibold rounded-full">
                        Default
                      </span>
                    )}
                    <div className="mb-4">
                      <span className="inline-block px-3 py-1 bg-surface-secondary text-foreground-secondary text-xs font-semibold rounded mb-3 capitalize">
                        {address.address_type}
                      </span>
                      <p className="text-foreground font-medium">{address.full_name}</p>
                      <p className="text-foreground">{address.address_line1}</p>
                      {address.address_line2 && (
                        <p className="text-foreground-secondary">{address.address_line2}</p>
                      )}
                      {address.landmark && (
                        <p className="text-foreground-secondary text-sm">Near: {address.landmark}</p>
                      )}
                      <p className="text-foreground-secondary">
                        {address.city}, {address.state} {address.postal_code}
                      </p>
                      <p className="text-foreground-secondary">{address.country}</p>
                      <p className="text-foreground-secondary mt-2">Phone: {address.phone}</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(address)}
                        className="px-4 py-2 bg-surface-secondary text-foreground-secondary rounded-lg hover:bg-border-default transition-colors text-sm font-medium"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(address.id)}
                        className="px-4 py-2 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors text-sm font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
