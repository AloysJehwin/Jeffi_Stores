import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { ActivityIndicator, Modal, Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { KeyboardScroll } from '../../ui/KeyboardScroll'
import { createAddress, lookupPincode } from '../../api/addresses'
import type { Address } from '../../types'
import { showToast } from '../../stores/toastStore'
import HeroIcon from './HeroIcon'
import { Checkbox, Input, Label, PhoneInput, Select } from './ui'
import { accent, status } from '../../theme'

// Mirror of controller-service components/shared/AccountAddressForm.tsx (+ the PIN lookup the pages share).

export const emptyAddressForm = {
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
export type AddressFormData = typeof emptyAddressForm
export type PinState = 'idle' | 'loading' | 'found' | 'error'

export default function AddressForm({
  formData,
  setFormData,
  editing,
  isSaving,
  pinLookupState,
  localities,
  onPincodeChange,
  onSubmit,
  onCancel,
}: {
  formData: AddressFormData
  setFormData: (d: AddressFormData) => void
  editing: boolean
  isSaving: boolean
  pinLookupState: PinState
  localities: string[]
  onPincodeChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const locked = pinLookupState === 'found'
  return (
    <View className="bg-surface-elevated rounded-lg border border-border-default p-4 mb-6" style={{ boxShadow: '0 1px 2px 0 rgba(0,0,0,0.05)' }}>
      <Text className="text-xl font-bold text-foreground mb-6">{editing ? 'Edit Address' : 'Add New Address'}</Text>
      <View className="gap-4">
        <Select
          label="Address Type"
          value={formData.address_type}
          onChange={v => setFormData({ ...formData, address_type: v })}
          options={[
            { value: 'shipping', label: 'Shipping' },
            { value: 'billing', label: 'Billing' },
            { value: 'both', label: 'Both' },
          ]}
        />
        <View>
          <Label>Full Name *</Label>
          <Input compact value={formData.full_name} onChangeText={v => setFormData({ ...formData, full_name: v })} autoCapitalize="words" />
        </View>
        <View>
          <Label>Phone Number *</Label>
          <PhoneInput value={formData.phone} onChange={v => setFormData({ ...formData, phone: v })} />
          {formData.phone.length > 0 && formData.phone.length !== 10 && (
            <Text className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</Text>
          )}
        </View>
        <View>
          <Label>Address Line 1 *</Label>
          <Input
            compact
            value={formData.address_line1}
            onChangeText={v => setFormData({ ...formData, address_line1: v })}
            placeholder="House/Flat No., Street, Area"
          />
        </View>
        <View>
          <Label>PIN Code *</Label>
          <View className="relative">
            <Input compact className="pr-10" value={formData.postal_code} onChangeText={onPincodeChange} keyboardType="number-pad" maxLength={6} placeholder="6-digit PIN code" />
            <View pointerEvents="none" className="absolute right-3 top-0 bottom-0 justify-center">
              {pinLookupState === 'loading' && <ActivityIndicator size="small" color={accent[500]} />}
              {pinLookupState === 'found' && <HeroIcon name="checkCircleSolid" size={16} color={status.success} />}
              {pinLookupState === 'error' && <HeroIcon name="xCircleSolid" size={16} color={status.heart} />}
            </View>
          </View>
          {pinLookupState === 'error' && <Text className="mt-1 text-xs text-red-500">PIN code not found. Please check and try again.</Text>}
        </View>
        <View>
          <Label>City / District *</Label>
          <Input
            compact
            muted={locked}
            editable={!locked}
            value={formData.city}
            onChangeText={v => !locked && setFormData({ ...formData, city: v })}
            placeholder="Auto-filled from PIN"
          />
        </View>
        <View>
          <Label>State *</Label>
          <Input
            compact
            muted={locked}
            editable={!locked}
            value={formData.state}
            onChangeText={v => !locked && setFormData({ ...formData, state: v })}
            placeholder="Auto-filled from PIN"
          />
        </View>
        {localities.length > 0 ? (
          <Select
            label="Locality / Village"
            value={formData.address_line2}
            onChange={v => setFormData({ ...formData, address_line2: v })}
            placeholder="Select locality"
            options={localities.map(l => ({ value: l, label: l }))}
          />
        ) : (
          <View>
            <Label>Locality / Village</Label>
            <Input compact value={formData.address_line2} onChangeText={v => setFormData({ ...formData, address_line2: v })} placeholder="Area, Colony, Village" />
          </View>
        )}
        <View>
          <Label>Landmark (Optional)</Label>
          <Input compact value={formData.landmark} onChangeText={v => setFormData({ ...formData, landmark: v })} placeholder="Nearby landmark" />
        </View>
        <Checkbox checked={formData.is_default} onChange={v => setFormData({ ...formData, is_default: v })}>
          <Text className="text-sm text-foreground-secondary">Set as default address</Text>
        </Checkbox>
        <View className="flex-row gap-4">
          <Pressable
            onPress={onSubmit}
            disabled={isSaving}
            className={`px-6 py-3 rounded-lg flex-row items-center ${isSaving ? 'bg-accent-300' : 'bg-accent-600'}`}
          >
            {isSaving && <ActivityIndicator size="small" color="white" style={{ marginRight: 8 }} />}
            <Text className="text-white font-semibold">{isSaving ? 'Saving...' : editing ? 'Update Address' : 'Save Address'}</Text>
          </Pressable>
          <Pressable onPress={onCancel} disabled={isSaving} className={`px-6 py-3 bg-surface-secondary rounded-lg ${isSaving ? 'opacity-50' : ''}`}>
            <Text className="text-foreground-secondary font-semibold">Cancel</Text>
          </Pressable>
        </View>
      </View>
    </View>
  )
}


/** The pages' 400ms-debounced /api/pincode lookup that fills city/state and the locality list. */
export function usePincodeLookup(setFormData: Dispatch<SetStateAction<AddressFormData>>) {
  const [pinLookupState, setPinLookupState] = useState<PinState>('idle')
  const [localities, setLocalities] = useState<string[]>([])
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handlePincodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    setFormData(prev => ({ ...prev, postal_code: digits, city: '', state: '', address_line2: '' }))
    setPinLookupState('idle')
    setLocalities([])
    if (debounce.current) clearTimeout(debounce.current)
    if (digits.length === 6) {
      setPinLookupState('loading')
      debounce.current = setTimeout(async () => {
        try {
          const data = await lookupPincode(digits)
          setFormData(prev => ({ ...prev, city: data.district, state: data.state }))
          setLocalities(data.postOffices || [])
          setPinLookupState('found')
        } catch {
          setPinLookupState('error')
        }
      }, 400)
    }
  }
  return { pinLookupState, setPinLookupState, localities, setLocalities, handlePincodeChange }
}

/** AddressFormModal (add only): the same form in a sheet; reports the saved address. */
export function AddressFormModal({
  isOpen,
  onClose,
  onSaved,
  defaults,
}: {
  isOpen: boolean
  onClose: () => void
  onSaved: (address: Address) => void
  defaults?: Partial<AddressFormData>
}) {
  const [formData, setFormData] = useState<AddressFormData>({ ...emptyAddressForm, ...defaults })
  const [isSaving, setIsSaving] = useState(false)
  const pin = usePincodeLookup(setFormData)
  const submit = async () => {
    if (formData.phone.length !== 10) return showToast('Enter a valid 10-digit mobile number', 'error')
    setIsSaving(true)
    try {
      const saved = await createAddress(formData as unknown as Omit<Address, 'id'>)
      setFormData({ ...emptyAddressForm, ...defaults })
      pin.setPinLookupState('idle')
      onSaved(saved)
    } catch (err: any) {
      showToast(err?.message || 'Failed to save address', 'error')
    } finally {
      setIsSaving(false)
    }
  }
  return (
    <Modal visible={isOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-surface">
        <KeyboardScroll contentContainerStyle={{ padding: 16, paddingTop: 24 }}>
          <AddressForm
            formData={formData}
            setFormData={setFormData}
            editing={false}
            isSaving={isSaving}
            pinLookupState={pin.pinLookupState}
            localities={pin.localities}
            onPincodeChange={pin.handlePincodeChange}
            onSubmit={submit}
            onCancel={onClose}
          />
        </KeyboardScroll>
      </View>
    </Modal>
  )
}
