import { useMemo, useState } from 'react'
import { Alert, Pressable, Text, View } from 'react-native'
import { KeyboardScroll } from '../../src/components/ui/KeyboardScroll'
import { useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import TopNav from '../../src/components/layout/TopNav'
import { createAddress, deleteAddress, listAddresses, updateAddress } from '../../src/api/addresses'
import type { Address } from '../../src/types'
import { showToast } from '../../src/stores/toastStore'
import AccountMobileHeader from '../../src/components/account/AccountMobileHeader'
import FeaturedProducts from '../../src/components/account/FeaturedProducts'
import HeroIcon from '../../src/components/account/HeroIcon'
import { useRequireAuth } from '../../src/components/account/hooks'
import { FilterChip, Pulse } from '../../src/components/account/ui'
import AddressForm, { emptyAddressForm as emptyForm, usePincodeLookup, type AddressFormData as FormData } from '../../src/components/account/AddressForm'
import { useTokens } from '../../src/theme'

// Mirror of controller-service components/shared/AccountAddresses.tsx + AccountAddressForm.tsx (visitor).

export default function AddressesScreen() {
  const t = useTokens()
  const qc = useQueryClient()
  const user = useRequireAuth()
  const { data: addresses = [], isLoading } = useQuery({ queryKey: ['addresses'], queryFn: listAddresses, enabled: !!user })

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Address | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [formData, setFormData] = useState<FormData>({ ...emptyForm })
  const { pinLookupState, setPinLookupState, localities, setLocalities, handlePincodeChange } = usePincodeLookup(setFormData)
  const [filterType, setFilterType] = useState('all')

  const filtered = useMemo(
    () => (filterType === 'all' ? addresses : addresses.filter(a => a.address_type === filterType || a.address_type === 'both')),
    [addresses, filterType]
  )

  const refresh = () => qc.invalidateQueries({ queryKey: ['addresses'] })

  const resetForm = () => {
    setShowForm(false)
    setEditing(null)
    setFormData({ ...emptyForm })
    setPinLookupState('idle')
    setLocalities([])
  }

  const handleSubmit = async () => {
    if (formData.phone.length !== 10) return showToast('Enter a valid 10-digit mobile number', 'error')
    setIsSaving(true)
    try {
      const body = formData as unknown as Omit<Address, 'id'>
      if (editing) await updateAddress(editing.id, body)
      else await createAddress(body)
      await refresh()
      resetForm()
    } catch (err: any) {
      showToast(err?.message || 'Failed to save address', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleEdit = (a: Address) => {
    setEditing(a)
    setFormData({
      address_type: a.address_type,
      full_name: a.full_name,
      address_line1: a.address_line1,
      address_line2: a.address_line2 || '',
      landmark: a.landmark || '',
      city: a.city,
      state: a.state,
      postal_code: a.postal_code,
      country: a.country,
      phone: (a.phone || '').replace(/^\+91/, ''),
      is_default: a.is_default,
    })
    setPinLookupState('found')
    setLocalities([])
    setShowForm(true)
  }

  const handleDelete = (id: string) => {
    Alert.alert('Delete Address', 'Are you sure you want to delete this address? This action cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteAddress(id)
            await refresh()
            showToast('Address deleted successfully', 'success')
          } catch (err: any) {
            showToast(err?.message || 'Failed to delete address', 'error')
          }
        },
      },
    ])
  }

  return (
    <View className="flex-1 bg-surface">
      <TopNav />
      <KeyboardScroll contentContainerStyle={{ paddingBottom: 32 }}>
        {!user || isLoading ? (
          <View className="px-4 pt-4 pb-8 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} className="bg-surface-elevated rounded-lg border border-border-default p-4">
                <Pulse className="h-4 bg-surface-secondary rounded w-24 mb-3" />
                <View className="gap-2">
                  <Pulse className="h-3 bg-surface-secondary rounded w-full" />
                  <Pulse className="h-3 bg-surface-secondary rounded w-3/4" />
                  <Pulse className="h-3 bg-surface-secondary rounded w-1/2" />
                </View>
              </View>
            ))}
          </View>
        ) : (
          <>
            <AccountMobileHeader />
            <View className="px-4 pt-4">
              <View className="flex-row flex-wrap items-center justify-between gap-3 mb-4">
                <View className="flex-row items-center gap-1.5">
                  {(['all', 'shipping', 'billing'] as const).map(f => (
                    <FilterChip key={f} label={f === 'all' ? 'All' : f} active={filterType === f} onPress={() => setFilterType(f)} />
                  ))}
                </View>
                <Pressable
                  onPress={() => {
                    if (showForm) return resetForm()
                    setEditing(null)
                    setFormData({
                      ...emptyForm,
                      full_name: [user.firstName, user.lastName].filter(Boolean).join(' '),
                      phone: (user.phone || '').replace(/^\+91/, ''),
                    })
                    setPinLookupState('idle')
                    setLocalities([])
                    setShowForm(true)
                  }}
                  className="px-5 py-2 bg-accent-600 rounded-lg"
                >
                  <Text className="text-white font-semibold text-sm">{showForm ? 'Cancel' : '+ Add New Address'}</Text>
                </Pressable>
              </View>

              {showForm && (
                <AddressForm
                  formData={formData}
                  setFormData={setFormData}
                  editing={!!editing}
                  isSaving={isSaving}
                  pinLookupState={pinLookupState}
                  localities={localities}
                  onPincodeChange={handlePincodeChange}
                  onSubmit={handleSubmit}
                  onCancel={() => {
                    setShowForm(false)
                    setEditing(null)
                  }}
                />
              )}

              {addresses.length === 0 ? (
                <View className="bg-surface-elevated rounded-lg border border-border-default p-12 items-center">
                  <HeroIcon name="location" size={64} color={t.foregroundMuted} strokeWidth={1.5} />
                  <Text className="text-xl font-semibold text-foreground mb-2 mt-4">No addresses saved</Text>
                  <Text className="text-foreground-secondary text-center">Add an address to make checkout faster.</Text>
                </View>
              ) : (
                <View className="gap-4">
                  {filtered.map(a => (
                    <View key={a.id} className="bg-surface-elevated rounded-lg border border-border-default p-4 relative" style={{ boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }}>
                      {a.is_default && (
                        <View className="absolute top-4 right-4 px-3 py-1 bg-green-100 dark:bg-green-900/30 rounded-full">
                          <Text className="text-green-800 dark:text-green-300 text-xs font-semibold">Default</Text>
                        </View>
                      )}
                      <View className="mb-4">
                        <View className="self-start px-3 py-1 bg-surface-secondary rounded mb-3">
                          <Text className="text-foreground-secondary text-xs font-semibold capitalize">{a.address_type}</Text>
                        </View>
                        <Text className="text-foreground font-medium">{a.full_name}</Text>
                        <Text className="text-foreground">{a.address_line1}</Text>
                        {!!a.address_line2 && <Text className="text-foreground-secondary">{a.address_line2}</Text>}
                        {!!a.landmark && <Text className="text-foreground-secondary text-sm">Near: {a.landmark}</Text>}
                        <Text className="text-foreground-secondary">
                          {a.city}, {a.state} {a.postal_code}
                        </Text>
                        <Text className="text-foreground-secondary">{a.country}</Text>
                        <Text className="text-foreground-secondary mt-2">Phone: {a.phone}</Text>
                      </View>
                      <View className="flex-row gap-2">
                        <Pressable onPress={() => handleEdit(a)} className="px-4 py-2 bg-surface-secondary rounded-lg">
                          <Text className="text-foreground-secondary text-sm font-medium">Edit</Text>
                        </Pressable>
                        <Pressable onPress={() => handleDelete(a.id)} className="px-4 py-2 bg-red-50 dark:bg-red-900/30 rounded-lg">
                          <Text className="text-red-600 dark:text-red-400 text-sm font-medium">Delete</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              )}
              <FeaturedProducts />
            </View>
          </>
        )}
      </KeyboardScroll>
    </View>
  )
}
