import { useState, useRef } from 'react'
import { View, Text, FlatList, TouchableOpacity, Alert, TextInput, ScrollView, Modal, ActivityIndicator } from 'react-native'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Ionicons } from '@expo/vector-icons'
import { listAddresses, createAddress, updateAddress, deleteAddress } from '../../src/api/addresses'
import { api } from '../../src/api/client'
import type { Address } from '../../src/types'
import AccountHeader from '../../src/components/account/AccountHeader'
import Spinner from '../../src/components/ui/Spinner'

const emptyForm = {
  address_type: 'shipping' as 'shipping' | 'billing' | 'both',
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

function Field({ label, value, onChange, placeholder, keyboardType, maxLength, editable }: any) {
  return (
    <View className="mb-3">
      <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder || label}
        placeholderTextColor="#9CA3AF"
        keyboardType={keyboardType || 'default'}
        maxLength={maxLength}
        editable={editable !== false}
        className={`border border-gray-200 dark:border-[#3f4150] rounded-xl px-4 py-3 text-gray-900 dark:text-gray-100 ${editable === false ? 'bg-gray-100 dark:bg-[#2e303b]' : 'bg-white dark:bg-[#24252f]'}`}
      />
    </View>
  )
}

function AddressForm({
  initial,
  onSave,
  onCancel,
  isSaving,
}: {
  initial: typeof emptyForm
  onSave: (data: typeof emptyForm) => void
  onCancel: () => void
  isSaving: boolean
}) {
  const [form, setForm] = useState(initial)
  const [pinStatus, setPinStatus] = useState<'idle' | 'loading' | 'found' | 'error'>('idle')
  const [localities, setLocalities] = useState<string[]>([])
  const [showLocalityPicker, setShowLocalityPicker] = useState(false)
  const pinDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const set = (key: keyof typeof emptyForm, val: any) => setForm(f => ({ ...f, [key]: val }))

  const handlePincodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setForm(f => ({ ...f, postal_code: digits, city: '', state: '', address_line2: '' }))
    setPinStatus('idle')
    setLocalities([])

    if (pinDebounce.current) clearTimeout(pinDebounce.current)

    if (digits.length === 6) {
      setPinStatus('loading')
      pinDebounce.current = setTimeout(async () => {
        try {
          const data = await api<{ district: string; state: string; postOffices: string[] }>(
            `/api/pincode/${digits}`,
            { token: null }
          )
          setForm(f => ({ ...f, city: data.district, state: data.state }))
          setLocalities(data.postOffices || [])
          setPinStatus('found')
        } catch {
          setPinStatus('error')
        }
      }, 400)
    }
  }

  const pinLocked = pinStatus === 'found'

  return (
    <ScrollView className="flex-1 px-4 pt-4" showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {/* Address type tabs */}
      <View className="flex-row gap-3 mb-3">
        {(['shipping', 'billing', 'both'] as const).map(t => (
          <TouchableOpacity
            key={t}
            onPress={() => set('address_type', t)}
            className={`flex-1 py-2 rounded-xl border-2 items-center ${form.address_type === t ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/20' : 'border-gray-200 dark:border-[#3f4150]'}`}
          >
            <Text className={`text-xs font-semibold capitalize ${form.address_type === t ? 'text-accent-600 dark:text-accent-400' : 'text-gray-500'}`}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Field label="Full Name *" value={form.full_name} onChange={(v: string) => set('full_name', v)} />
      <Field label="Address Line 1 *" value={form.address_line1} onChange={(v: string) => set('address_line1', v)} placeholder="House/Flat No., Street, Area" />

      {/* PIN Code with lookup indicator */}
      <View className="mb-3">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">PIN Code *</Text>
        <View className="relative">
          <TextInput
            value={form.postal_code}
            onChangeText={handlePincodeChange}
            placeholder="6-digit PIN code"
            placeholderTextColor="#9CA3AF"
            keyboardType="number-pad"
            maxLength={6}
            className="border border-gray-200 dark:border-[#3f4150] rounded-xl px-4 py-3 pr-12 text-gray-900 dark:text-gray-100 bg-white dark:bg-[#24252f]"
          />
          <View className="absolute right-4 top-0 bottom-0 justify-center">
            {pinStatus === 'loading' && <ActivityIndicator size="small" color="#7cb900" />}
            {pinStatus === 'found' && <Ionicons name="checkmark-circle" size={20} color="#22c55e" />}
            {pinStatus === 'error' && <Ionicons name="close-circle" size={20} color="#ef4444" />}
          </View>
        </View>
        {pinStatus === 'error' && (
          <Text className="text-xs text-red-500 mt-1">PIN code not found. Please check and try again.</Text>
        )}
      </View>

      {/* Locality picker — dropdown when localities available */}
      <View className="mb-3">
        <Text className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Locality / Village</Text>
        {localities.length > 0 ? (
          <TouchableOpacity
            onPress={() => setShowLocalityPicker(true)}
            className="border border-gray-200 dark:border-[#3f4150] rounded-xl px-4 py-3 bg-white dark:bg-[#24252f] flex-row items-center justify-between"
          >
            <Text className={form.address_line2 ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}>
              {form.address_line2 || 'Select locality'}
            </Text>
            <Ionicons name="chevron-down" size={18} color="#9CA3AF" />
          </TouchableOpacity>
        ) : (
          <TextInput
            value={form.address_line2}
            onChangeText={(v) => set('address_line2', v)}
            placeholder="Area, Colony, Village"
            placeholderTextColor="#9CA3AF"
            className="border border-gray-200 dark:border-[#3f4150] rounded-xl px-4 py-3 text-gray-900 dark:text-gray-100 bg-white dark:bg-[#24252f]"
          />
        )}
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="City *" value={form.city} onChange={(v: string) => !pinLocked && set('city', v)} editable={!pinLocked} placeholder="Auto-filled from PIN" />
        </View>
        <View className="flex-1">
          <Field label="State *" value={form.state} onChange={(v: string) => !pinLocked && set('state', v)} editable={!pinLocked} placeholder="Auto-filled from PIN" />
        </View>
      </View>

      <Field label="Landmark" value={form.landmark} onChange={(v: string) => set('landmark', v)} placeholder="Near / Opposite" />
      <Field label="Phone *" value={form.phone} onChange={(v: string) => set('phone', v.replace(/\D/g, '').slice(0, 10))} keyboardType="phone-pad" maxLength={10} />

      <TouchableOpacity
        onPress={() => set('is_default', !form.is_default)}
        className="flex-row items-center gap-3 mb-6"
      >
        <View className={`w-5 h-5 rounded border-2 items-center justify-center ${form.is_default ? 'bg-accent-500 border-accent-500' : 'border-gray-300'}`}>
          {form.is_default && <Ionicons name="checkmark" size={12} color="white" />}
        </View>
        <Text className="text-sm text-gray-700 dark:text-gray-300">Set as default address</Text>
      </TouchableOpacity>

      <View className="flex-row gap-3 mb-8">
        <TouchableOpacity
          onPress={() => onSave(form)}
          disabled={isSaving}
          className="flex-1 py-3.5 bg-accent-500 rounded-xl items-center disabled:opacity-50"
        >
          <Text className="text-white font-semibold">{isSaving ? 'Saving...' : 'Save Address'}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onCancel} className="flex-1 py-3.5 bg-gray-100 dark:bg-[#2e303b] rounded-xl items-center">
          <Text className="text-gray-600 dark:text-gray-300 font-semibold">Cancel</Text>
        </TouchableOpacity>
      </View>

      {/* Locality picker modal */}
      <Modal visible={showLocalityPicker} transparent animationType="slide">
        <View className="flex-1 justify-end bg-black/50">
          <View className="bg-white dark:bg-[#24252f] rounded-t-2xl max-h-[60%]">
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-[#3f4150]">
              <Text className="font-bold text-gray-900 dark:text-gray-100 text-base">Select Locality</Text>
              <TouchableOpacity onPress={() => setShowLocalityPicker(false)}>
                <Ionicons name="close" size={22} color="#6B7280" />
              </TouchableOpacity>
            </View>
            <FlatList
              data={localities}
              keyExtractor={(item) => item}
              contentContainerStyle={{ paddingVertical: 8 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => { set('address_line2', item); setShowLocalityPicker(false) }}
                  className={`px-4 py-3.5 flex-row items-center justify-between border-b border-gray-50 dark:border-[#3f4150] ${form.address_line2 === item ? 'bg-accent-50 dark:bg-accent-900/20' : ''}`}
                >
                  <Text className={`text-sm ${form.address_line2 === item ? 'text-accent-600 dark:text-accent-400 font-semibold' : 'text-gray-800 dark:text-gray-200'}`}>
                    {item}
                  </Text>
                  {form.address_line2 === item && <Ionicons name="checkmark" size={16} color="#7cb900" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </ScrollView>
  )
}

export default function AddressesScreen() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Address | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['addresses'], queryFn: listAddresses })

  const saveMutation = useMutation({
    mutationFn: (form: typeof emptyForm) =>
      editing ? updateAddress(editing.id, form) : createAddress(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['addresses'] })
      setShowForm(false)
      setEditing(null)
    },
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to save address'),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteAddress,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }),
    onError: (err: any) => Alert.alert('Error', err.message || 'Failed to delete address'),
  })

  const addresses = data || []

  const openEdit = (addr: Address) => {
    setEditing(addr)
    setShowForm(true)
  }

  const openAdd = () => {
    setEditing(null)
    setShowForm(true)
  }

  const formInitial = editing
    ? {
        address_type: editing.address_type as 'shipping' | 'billing' | 'both',
        full_name: editing.full_name,
        address_line1: editing.address_line1,
        address_line2: editing.address_line2 || '',
        landmark: editing.landmark || '',
        city: editing.city,
        state: editing.state,
        postal_code: editing.postal_code,
        country: editing.country || 'India',
        phone: editing.phone,
        is_default: editing.is_default,
      }
    : emptyForm

  return (
    <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
      <AccountHeader activeTab="addresses" />

      {/* Add button */}
      <View className="px-4 mb-3">
        <TouchableOpacity
          onPress={openAdd}
          className="bg-accent-500 py-3.5 rounded-xl flex-row items-center justify-center gap-2"
        >
          <Ionicons name="add" size={18} color="white" />
          <Text className="text-white font-semibold">+ Add New Address</Text>
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <Spinner />
      ) : (
        <FlatList
          data={addresses}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 12, paddingBottom: 32 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View className="items-center justify-center py-16">
              <Ionicons name="location-outline" size={64} color="#9CA3AF" />
              <Text className="text-gray-500 dark:text-gray-400 text-lg mt-4">No saved addresses</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View className="bg-white dark:bg-[#24252f] rounded-xl border border-gray-200 dark:border-[#3f4150] p-4">
              <View className="flex-row items-center gap-2 mb-2">
                <View className="bg-gray-100 dark:bg-[#2e303b] px-2 py-0.5 rounded">
                  <Text className="text-gray-600 dark:text-gray-400 text-xs capitalize">{item.address_type}</Text>
                </View>
                {item.is_default && (
                  <View className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded">
                    <Text className="text-green-700 dark:text-green-400 text-xs font-semibold">Default</Text>
                  </View>
                )}
              </View>

              <Text className="font-bold text-gray-900 dark:text-gray-100 mb-0.5">{item.full_name}</Text>
              <Text className="text-gray-600 dark:text-gray-400 text-sm">{item.address_line1}</Text>
              {item.address_line2 ? <Text className="text-gray-600 dark:text-gray-400 text-sm">{item.address_line2}</Text> : null}
              {item.landmark ? <Text className="text-gray-500 dark:text-gray-500 text-sm">Near: {item.landmark}</Text> : null}
              <Text className="text-gray-600 dark:text-gray-400 text-sm">{item.city}, {item.state} {item.postal_code}</Text>
              <Text className="text-gray-600 dark:text-gray-400 text-sm">{item.country}</Text>
              <Text className="text-gray-600 dark:text-gray-400 text-sm mt-1">Phone: {item.phone}</Text>

              <View className="flex-row gap-3 mt-3">
                <TouchableOpacity
                  onPress={() => openEdit(item)}
                  className="flex-1 py-2 border border-gray-200 dark:border-[#3f4150] rounded-lg items-center"
                >
                  <Text className="text-sm text-gray-600 dark:text-gray-300 font-medium">Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => Alert.alert('Delete Address', 'Remove this address?', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate(item.id) },
                  ])}
                  className="flex-1 py-2 border border-red-200 dark:border-red-800 rounded-lg items-center bg-red-50 dark:bg-red-900/20"
                >
                  <Text className="text-sm text-red-600 font-medium">Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        />
      )}

      {/* Add/Edit form modal */}
      <Modal visible={showForm} animationType="slide" presentationStyle="pageSheet">
        <View className="flex-1 bg-gray-50 dark:bg-[#1a1b23]">
          <View className="flex-row items-center px-4 py-3 border-b border-gray-100 dark:border-[#3f4150] bg-white dark:bg-[#24252f]">
            <TouchableOpacity onPress={() => { setShowForm(false); setEditing(null) }}>
              <Ionicons name="close" size={24} color="#6B7280" />
            </TouchableOpacity>
            <Text className="flex-1 text-center font-semibold text-gray-900 dark:text-gray-100">
              {editing ? 'Edit Address' : 'Add New Address'}
            </Text>
            <View className="w-6" />
          </View>
          <AddressForm
            key={editing?.id ?? 'new'}
            initial={formInitial}
            onSave={(form) => saveMutation.mutate(form)}
            onCancel={() => { setShowForm(false); setEditing(null) }}
            isSaving={saveMutation.isPending}
          />
        </View>
      </Modal>
    </View>
  )
}
