'use client'

import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef, useMemo } from 'react'
import { bp } from '@/lib/business-path'
import AccountMobileHeader from '@/components/visitor/AccountMobileHeader'
import BusinessAccountMobileHeader from '@/components/business/AccountMobileHeader'
import FeaturedProducts from '@/components/visitor/FeaturedProducts'
import AccountAddressForm from '@/components/shared/AccountAddressForm'

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

const emptyForm = {
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
}

function AccountAddresses({ isBusiness }: { isBusiness: boolean }) {
  const { user, isLoading } = useAuth()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const router = useRouter()
  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingAddress, setEditingAddress] = useState<Address | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState({ ...emptyForm })
  const [pinLookupState, setPinLookupState] = useState<'idle' | 'loading' | 'found' | 'error'>('idle')
  const [localities, setLocalities] = useState<string[]>([])
  const pinDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [filterType, setFilterType] = useState<string>('all')

  const portalHeader: Record<string, string> = isBusiness ? { 'X-Auth-Portal': 'business' } : {}
  const portalFetch: RequestInit = isBusiness ? { credentials: 'include' } : {}

  const filteredAddresses = useMemo(
    () =>
      filterType === 'all'
        ? addresses
        : addresses.filter(a => a.address_type === filterType || a.address_type === 'both'),
    [addresses, filterType]
  )

  useEffect(() => {
    if (!isLoading && !user) {
      router.push(
        isBusiness ? bp('/business/signin?redirect=/account/addresses') : '/login?redirect=/account/addresses'
      )
    }
    if (user) {
      fetchAddresses()
    }
  }, [user, isLoading, router])

  const fetchAddresses = async () => {
    try {
      const response = await fetch('/api/user/addresses', {
        ...portalFetch,
        headers: { ...portalHeader },
      })
      if (response.ok) {
        const data = await response.json()
        setAddresses(data.addresses || [])
      }
    } catch {
    } finally {
      setLoading(false)
    }
  }

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
        headers: { 'Content-Type': 'application/json', ...portalHeader },
        ...portalFetch,
        body: JSON.stringify(formData),
      })

      if (response.ok) {
        await fetchAddresses()
        setShowForm(false)
        setEditingAddress(null)
        setFormData({ ...emptyForm })
        setPinLookupState('idle')
        setLocalities([])
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
    setPinLookupState('found')
    setLocalities([])
    setShowForm(true)
  }

  const handleDelete = async (addressId: string) => {
    const ok = await confirm({
      title: 'Delete Address',
      message: 'Are you sure you want to delete this address? This action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      variant: 'danger',
    })
    if (!ok) return
    try {
      const response = await fetch(`/api/user/addresses/${addressId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { ...portalHeader },
      })
      if (response.ok) {
        await fetchAddresses()
        showToast('Address deleted successfully', 'success')
      } else {
        const data = await response.json()
        showToast(data.error || 'Failed to delete address', 'error')
      }
    } catch {
      showToast('Failed to delete address', 'error')
    }
  }

  if (isLoading || loading) {
    return (
      <div className="container mx-auto px-4 pt-4 pb-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="bg-surface-elevated rounded-lg border border-border-default p-4"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <div className="h-4 bg-surface-secondary rounded w-24 mb-3" />
              <div className="space-y-2">
                <div className="h-3 bg-surface-secondary rounded w-full" />
                <div className="h-3 bg-surface-secondary rounded w-3/4" />
                <div className="h-3 bg-surface-secondary rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="bg-surface min-h-screen">
      {isBusiness ? <BusinessAccountMobileHeader /> : <AccountMobileHeader />}

      <div className="container mx-auto px-4 pt-4">
        <div>
          {/* Type filter + Add button row */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-1.5">
              {(['all', 'shipping', 'billing'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                    filterType === t
                      ? 'bg-accent-500 text-white'
                      : 'bg-surface-elevated border border-border-default text-foreground-secondary hover:bg-surface-secondary'
                  }`}
                >
                  {t === 'all' ? 'All' : t}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setEditingAddress(null)
                const fullName = user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : ''
                const phone = user?.phone ? user.phone.replace(/^\+91/, '') : ''
                setFormData({ ...emptyForm, full_name: fullName, phone })
                setPinLookupState('idle')
                setLocalities([])
                setShowForm(!showForm)
              }}
              className="px-5 py-2 bg-accent-600 text-white rounded-lg hover:bg-accent-700 transition-colors font-semibold text-sm"
            >
              {showForm ? 'Cancel' : '+ Add New Address'}
            </button>
          </div>

          {showForm && (
            <AccountAddressForm
              formData={formData}
              setFormData={setFormData}
              editing={!!editingAddress}
              isSaving={isSaving}
              pinLookupState={pinLookupState}
              localities={localities}
              onPincodeChange={handlePincodeChange}
              onSubmit={handleSubmit}
              onCancel={() => {
                setShowForm(false)
                setEditingAddress(null)
              }}
            />
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
              {filteredAddresses.map(address => (
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
                    {address.address_line2 && <p className="text-foreground-secondary">{address.address_line2}</p>}
                    {address.landmark && <p className="text-foreground-secondary text-sm">Near: {address.landmark}</p>}
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
          {!isBusiness && <FeaturedProducts />}
        </div>
      </div>
    </div>
  )
}

export function AccountAddressesVisitor() {
  return <AccountAddresses isBusiness={false} />
}

export function AccountAddressesBusiness() {
  return <AccountAddresses isBusiness={true} />
}
