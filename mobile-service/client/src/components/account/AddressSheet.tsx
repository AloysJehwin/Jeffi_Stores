import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { View } from 'react-native'
import { CircleCheck, CircleX } from 'lucide-react-native'
import { createAddress, lookupPincode } from '../../api/addresses'
import type { Address } from '../../types'
import { showToast } from '../../stores/toastStore'
import { Button, Checkbox, ModalSheet, PhoneField, SelectField, Spinner, TextField } from '../../ui'
import { status } from '../../theme'

// The account address form (controller-service components/shared/AccountAddressForm.tsx) as a sheet,
// plus the PIN lookup the pages share.

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

const TYPES = [
  { value: 'shipping', label: 'Shipping' },
  { value: 'billing', label: 'Billing' },
  { value: 'both', label: 'Both' },
]

export default function AddressSheet({
  open,
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
  open: boolean
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
  const set = (patch: Partial<AddressFormData>) => setFormData({ ...formData, ...patch })
  const pinIcon =
    pinLookupState === 'loading' ? (
      <Spinner size="small" fill={false} />
    ) : pinLookupState === 'found' ? (
      <CircleCheck size={20} color={status.success} />
    ) : pinLookupState === 'error' ? (
      <CircleX size={20} color={status.danger} />
    ) : null

  return (
    <ModalSheet
      open={open}
      onClose={() => !isSaving && onCancel()}
      title={editing ? 'Edit Address' : 'Add New Address'}
      footer={<Button label={editing ? 'Update Address' : 'Save Address'} loading={isSaving} loadingLabel="Saving..." onPress={onSubmit} />}
    >
      <View className="gap-4">
        <SelectField label="Address Type" value={formData.address_type} onChange={v => set({ address_type: v })} options={TYPES} />
        <TextField label="Full Name" required value={formData.full_name} onChangeText={v => set({ full_name: v })} autoCapitalize="words" />
        <PhoneField
          label="Phone Number"
          required
          value={formData.phone}
          onChange={v => set({ phone: v })}
          error={formData.phone.length > 0 && formData.phone.length !== 10 ? 'Enter a valid 10-digit mobile number' : null}
        />
        <TextField label="Address Line 1" required value={formData.address_line1} onChangeText={v => set({ address_line1: v })} placeholder="House/Flat No., Street, Area" />
        <TextField
          label="PIN Code"
          required
          value={formData.postal_code}
          onChangeText={onPincodeChange}
          keyboardType="number-pad"
          maxLength={6}
          placeholder="6-digit PIN code"
          suffix={pinIcon}
          error={pinLookupState === 'error' ? 'PIN code not found. Please check and try again.' : null}
        />
        <TextField
          label="City / District"
          required
          editable={!locked}
          value={formData.city}
          onChangeText={v => !locked && set({ city: v })}
          placeholder="Auto-filled from PIN"
        />
        <TextField label="State" required editable={!locked} value={formData.state} onChangeText={v => !locked && set({ state: v })} placeholder="Auto-filled from PIN" />
        {localities.length > 0 ? (
          <SelectField
            label="Locality / Village"
            value={formData.address_line2}
            onChange={v => set({ address_line2: v })}
            placeholder="Select locality"
            options={localities.map(l => ({ value: l, label: l }))}
          />
        ) : (
          <TextField label="Locality / Village" value={formData.address_line2} onChangeText={v => set({ address_line2: v })} placeholder="Area, Colony, Village" />
        )}
        <TextField label="Landmark (Optional)" value={formData.landmark} onChangeText={v => set({ landmark: v })} placeholder="Nearby landmark" />
        <Checkbox checked={formData.is_default} onChange={v => set({ is_default: v })} label="Set as default address" />
      </View>
    </ModalSheet>
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

/** Add-only: the same sheet with its own state; reports the saved address. */
export function AddAddressSheet({
  isOpen,
  onClose,
  onSaved,
  defaults,
  strict,
}: {
  isOpen: boolean
  onClose: () => void
  onSaved: (address: Address) => void
  defaults?: Partial<AddressFormData>
  /** Checkout's form: refilled from `defaults` on every open, all required fields checked, blank optionals sent as null, a toast on save. */
  strict?: boolean
}) {
  const [formData, setFormData] = useState<AddressFormData>({ ...emptyAddressForm, ...defaults })
  const [isSaving, setIsSaving] = useState(false)
  const pin = usePincodeLookup(setFormData)
  const { setPinLookupState, setLocalities } = pin
  const defaultsRef = useRef(defaults)
  defaultsRef.current = defaults
  useEffect(() => {
    if (!strict || !isOpen) return
    setFormData({ ...emptyAddressForm, ...defaultsRef.current })
    setPinLookupState('idle')
    setLocalities([])
  }, [strict, isOpen, setPinLookupState, setLocalities])
  const submit = async () => {
    if (formData.phone.length !== 10) return showToast('Enter a valid 10-digit mobile number', 'error')
    if (strict && (!formData.full_name.trim() || !formData.address_line1.trim() || formData.postal_code.length !== 6 || !formData.city || !formData.state)) {
      return showToast('Please fill in all required fields', 'error')
    }
    setIsSaving(true)
    try {
      const payload = strict ? { ...formData, address_line2: formData.address_line2 || null, landmark: formData.landmark || null } : formData
      const saved = await createAddress(payload as unknown as Omit<Address, 'id'>)
      setFormData({ ...emptyAddressForm, ...defaults })
      pin.setPinLookupState('idle')
      if (strict) showToast('Address saved', 'success')
      onSaved(saved)
    } catch (err: any) {
      showToast(err?.message || 'Failed to save address', 'error')
    } finally {
      setIsSaving(false)
    }
  }
  return (
    <AddressSheet
      open={isOpen}
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
  )
}
