import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MapPin, Pencil, Plus, Trash2 } from 'lucide-react-native'
import { createAddress, deleteAddress, listAddresses, updateAddress } from '../../src/api/addresses'
import type { Address } from '../../src/types'
import { showToast } from '../../src/stores/toastStore'
import FeaturedProducts from '../../src/components/account/FeaturedProducts'
import { useRequireAuth } from '../../src/components/account/hooks'
import AddressSheet, { emptyAddressForm as emptyForm, usePincodeLookup, type AddressFormData as FormData } from '../../src/components/account/AddressSheet'
import { status } from '../../src/theme'
import { Badge, BodySmall, Button, Card, Chip, ChipGroup, confirm, EmptyState, IconButton, List, Screen, Skeleton, Subheading } from '../../src/ui'

// Mirror of controller-service components/shared/AccountAddresses.tsx + AccountAddressForm.tsx (visitor).

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// The loaded page: filter chips, then address cards.
function AddressesLoading() {
  return (
    <View>
      <View className="mb-4 flex-row gap-2">
        {[52, 86, 72].map((w, i) => (
          <Skeleton key={i} width={w} height={38} rounded="rounded-full" />
        ))}
      </View>
      <View className="gap-3">
        {[0, 1, 2].map(i => (
          <View key={i} className="flex-row gap-3 rounded-panel bg-surface-elevated p-4 dark:border dark:border-border-default">
            <View className="flex-1">
              <View className="mb-3 flex-row gap-1.5">
                <Skeleton width={72} height={24} rounded="rounded-full" />
                <Skeleton width={60} height={24} rounded="rounded-full" />
              </View>
              <View className="gap-2">
                <Skeleton height={16} width="45%" />
                <Skeleton height={12} width="85%" />
                <Skeleton height={12} width="65%" />
                <Skeleton height={12} width="40%" />
              </View>
            </View>
            <View className="flex-row gap-1">
              <Skeleton width={36} height={36} rounded="rounded-full" />
              <Skeleton width={36} height={36} rounded="rounded-full" />
            </View>
          </View>
        ))}
      </View>
    </View>
  )
}

export default function AddressesScreen() {
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

  const handleAdd = () => {
    if (!user) return
    setEditing(null)
    setFormData({
      ...emptyForm,
      full_name: [user.firstName, user.lastName].filter(Boolean).join(' '),
      phone: (user.phone || '').replace(/^\+91/, ''),
    })
    setPinLookupState('idle')
    setLocalities([])
    setShowForm(true)
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

  const handleDelete = async (id: string) => {
    const ok = await confirm({
      title: 'Delete Address',
      message: 'Are you sure you want to delete this address? This action cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    try {
      await deleteAddress(id)
      await refresh()
      showToast('Address deleted successfully', 'success')
    } catch (err: any) {
      showToast(err?.message || 'Failed to delete address', 'error')
    }
  }

  const loading = !user || isLoading

  const card = ({ item: a }: { item: Address }) => (
    <Card className="flex-row items-start gap-2">
      <View className="flex-1">
        <View className="mb-2 flex-row flex-wrap gap-1.5">
          <Badge label={capital(a.address_type)} />
          {a.is_default ? <Badge label="Default" tone="success" /> : null}
        </View>
        <Subheading>{a.full_name}</Subheading>
        <BodySmall className="mt-0.5 text-foreground">{a.address_line1}</BodySmall>
        {!!a.address_line2 && <BodySmall>{a.address_line2}</BodySmall>}
        {!!a.landmark && <BodySmall>Near: {a.landmark}</BodySmall>}
        <BodySmall>
          {a.city}, {a.state} {a.postal_code}
        </BodySmall>
        <BodySmall>{a.country}</BodySmall>
        <BodySmall className="mt-2">Phone: {a.phone}</BodySmall>
      </View>
      <View className="-mr-2 -mt-2 flex-row">
        <IconButton icon={Pencil} label={`Edit address for ${a.full_name}`} onPress={() => handleEdit(a)} />
        <IconButton icon={Trash2} label={`Delete address for ${a.full_name}`} color={status.danger} onPress={() => handleDelete(a.id)} />
      </View>
    </Card>
  )

  const addButton = <Button label="Add New Address" icon={Plus} onPress={handleAdd} />
  const sheet = (
    <AddressSheet
      open={showForm}
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
  )

  if (loading || addresses.length === 0) {
    return (
      <Screen title="My Addresses" loading={loading} skeleton={<AddressesLoading />} footer={loading ? undefined : addButton}>
        <EmptyState icon={MapPin} title="No addresses saved" message="Add an address to make checkout faster." />
        <FeaturedProducts />
        {sheet}
      </Screen>
    )
  }

  return (
    <Screen title="My Addresses" mode="none" footer={addButton}>
      <List
        data={filtered}
        keyExtractor={a => a.id}
        renderItem={card}
        gap={12}
        footerBar
        ListHeaderComponent={
          <ChipGroup className="mb-4">
            {(['all', 'shipping', 'billing'] as const).map(f => (
              <Chip key={f} label={capital(f)} selected={filterType === f} onPress={() => setFilterType(f)} />
            ))}
          </ChipGroup>
        }
        ListFooterComponent={<FeaturedProducts />}
      />
      {sheet}
    </Screen>
  )
}
