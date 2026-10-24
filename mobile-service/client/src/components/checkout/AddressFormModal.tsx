import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native'
import { KeyboardScroll } from '../ui/KeyboardScroll'
import { Check, ChevronDown, CircleCheck, CircleX, X } from 'lucide-react-native'
import { createAddress, lookupPincode, updateAddress } from '../../api/addresses'
import { useAuthStore } from '../../stores/authStore'
import { showToast } from '../../stores/toastStore'
import { accent, status, useTokens } from '../../theme'
import type { Address } from '../../types'

// Mirror of controller-service components/visitor/AddressFormModal.tsx (Google Places autocomplete is web-only).
type Form = {
  address_type: Address['address_type']
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

const TYPES: { value: Address['address_type']; label: string }[] = [
  { value: 'shipping', label: 'Shipping' },
  { value: 'billing', label: 'Billing' },
  { value: 'both', label: 'Both' },
]

const INPUT = 'w-full rounded-lg border border-border-secondary px-4 py-2 text-foreground'

function Label({ children }: { children: string }) {
  return <Text className="mb-2 text-sm font-medium text-foreground-secondary">{children}</Text>
}

/** The web's CustomSelect: a field that opens its options inline. */
function Select({
  label,
  value,
  placeholder,
  options,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  const t = useTokens()
  const [open, setOpen] = useState(false)
  const current = options.find(o => o.value === value)
  return (
    <View>
      <Label>{label}</Label>
      <Pressable onPress={() => setOpen(o => !o)} className={`${INPUT} flex-row items-center justify-between bg-surface`}>
        <Text className={current ? 'text-foreground' : 'text-foreground-muted'}>{current?.label ?? placeholder ?? ''}</Text>
        <ChevronDown size={16} color={t.foregroundMuted} />
      </Pressable>
      {open && (
        <View className="mt-1 overflow-hidden rounded-lg border border-border-default bg-surface-elevated shadow-lg">
          {options.map(o => (
            <Pressable
              key={o.value}
              onPress={() => {
                onChange(o.value)
                setOpen(false)
              }}
              className={`flex-row items-center justify-between px-4 py-2.5 ${o.value === value ? 'bg-accent-50 dark:bg-accent-900/30' : ''}`}
            >
              <Text className="text-sm text-foreground">{o.label}</Text>
              {o.value === value ? <Check size={14} color={accent[500]} /> : null}
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

export default function AddressFormModal({
  isOpen,
  onClose,
  onSaved,
  editAddress,
}: {
  isOpen: boolean
  onClose: () => void
  onSaved: (address: Address) => void
  editAddress?: Address | null
}) {
  const t = useTokens()
  const user = useAuthStore(s => s.user)
  const [saving, setSaving] = useState(false)
  const [pinState, setPinState] = useState<'idle' | 'loading' | 'found' | 'error'>('idle')
  const [localities, setLocalities] = useState<string[]>([])
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [form, setForm] = useState<Form>({
    address_type: 'shipping', full_name: '', address_line1: '', address_line2: '', landmark: '',
    city: '', state: '', postal_code: '', country: 'India', phone: '', is_default: true,
  })
  const set = (patch: Partial<Form>) => setForm(f => ({ ...f, ...patch }))

  useEffect(() => {
    if (!isOpen) return
    if (editAddress) {
      setForm({
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
      setPinState('found')
    } else {
      setForm({
        address_type: 'shipping',
        full_name: user ? [user.firstName, user.lastName].filter(Boolean).join(' ') : '',
        address_line1: '', address_line2: '', landmark: '', city: '', state: '', postal_code: '', country: 'India',
        phone: user?.phone ? user.phone.replace(/^\+91/, '') : '',
        is_default: true,
      })
      setPinState('idle')
    }
    setLocalities([])
  }, [editAddress, isOpen, user])

  useEffect(() => () => {
    if (pinTimer.current) clearTimeout(pinTimer.current)
  }, [])

  const onPin = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6)
    set({ postal_code: digits, city: '', state: '', address_line2: '' })
    setPinState('idle')
    setLocalities([])
    if (pinTimer.current) clearTimeout(pinTimer.current)
    if (digits.length !== 6) return
    setPinState('loading')
    pinTimer.current = setTimeout(async () => {
      try {
        const d = await lookupPincode(digits)
        set({ city: d.district, state: d.state })
        setLocalities(d.postOffices || [])
        setPinState('found')
      } catch {
        setPinState('error')
      }
    }, 400)
  }

  const submit = async () => {
    if (form.phone.length !== 10) return showToast('Enter a valid 10-digit mobile number', 'error')
    if (!form.full_name.trim() || !form.address_line1.trim() || form.postal_code.length !== 6 || !form.city || !form.state) {
      return showToast('Please fill in all required fields', 'error')
    }
    setSaving(true)
    try {
      const payload = { ...form, address_line2: form.address_line2 || null, landmark: form.landmark || null }
      const saved = editAddress ? await updateAddress(editAddress.id, payload) : await createAddress(payload)
      showToast(editAddress ? 'Address updated' : 'Address saved', 'success')
      onSaved(saved)
    } catch (e) {
      showToast(e instanceof Error && e.message ? e.message : 'Failed to save address', 'error')
    } finally {
      setSaving(false)
    }
  }

  const pinDone = pinState === 'found'

  return (
    <Modal visible={isOpen} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/30 p-4">
        <View className="w-full rounded-lg bg-surface-elevated shadow-xl" style={{ maxHeight: '90%' }}>
          <KeyboardScroll contentContainerStyle={{ padding: 16 }}>
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-bold text-foreground">{editAddress ? 'Edit Address' : 'Add Delivery Address'}</Text>
              <Pressable onPress={onClose} hitSlop={8} className="p-1">
                <X size={20} color={t.foregroundMuted} />
              </Pressable>
            </View>

            <View className="gap-4">
              <Select
                label="Address Type *"
                value={form.address_type}
                options={TYPES}
                onChange={v => set({ address_type: v as Address['address_type'] })}
              />
              <View>
                <Label>Full Name *</Label>
                <TextInput
                  value={form.full_name}
                  onChangeText={v => set({ full_name: v })}
                  className={`${INPUT} bg-surface`}
                  placeholderTextColor={t.foregroundMuted}
                />
              </View>

              <View>
                <Label>Phone Number *</Label>
                <View className="flex-row">
                  <View className="justify-center rounded-l-lg border border-r-0 border-border-secondary bg-surface px-4 py-2">
                    <Text className="text-sm font-medium text-foreground-secondary">+91</Text>
                  </View>
                  <TextInput
                    value={form.phone}
                    onChangeText={v => set({ phone: v.replace(/\D/g, '').slice(0, 10) })}
                    keyboardType="number-pad"
                    maxLength={10}
                    placeholder="00000 00000"
                    placeholderTextColor={t.foregroundMuted}
                    className="flex-1 rounded-r-lg border border-border-secondary bg-surface px-4 py-2 text-foreground"
                  />
                </View>
                {form.phone.length > 0 && form.phone.length !== 10 ? (
                  <Text className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</Text>
                ) : null}
              </View>

              <View>
                <Label>Address Line 1 *</Label>
                <TextInput
                  value={form.address_line1}
                  onChangeText={v => set({ address_line1: v })}
                  placeholder="Start typing your street address…"
                  placeholderTextColor={t.foregroundMuted}
                  autoComplete="off"
                  className={`${INPUT} bg-surface`}
                />
              </View>

              <View>
                <Label>PIN Code *</Label>
                <View className="justify-center">
                  <TextInput
                    value={form.postal_code}
                    onChangeText={onPin}
                    keyboardType="number-pad"
                    maxLength={6}
                    placeholder="6-digit PIN code"
                    placeholderTextColor={t.foregroundMuted}
                    className={`${INPUT} bg-surface pr-10`}
                  />
                  <View className="absolute right-3">
                    {pinState === 'loading' && <ActivityIndicator size="small" color={accent[500]} />}
                    {pinState === 'found' && <CircleCheck size={16} color={status.white} fill={status.success} />}
                    {pinState === 'error' && <CircleX size={16} color={status.white} fill={status.danger} />}
                  </View>
                </View>
                {pinState === 'error' ? (
                  <Text className="mt-1 text-xs text-red-500">PIN code not found. Please check and try again.</Text>
                ) : null}
              </View>

              <View>
                <Label>City / District *</Label>
                <TextInput
                  value={form.city}
                  editable={!pinDone}
                  onChangeText={v => set({ city: v })}
                  placeholder="Auto-filled from PIN"
                  placeholderTextColor={t.foregroundMuted}
                  className={`${INPUT} ${pinDone ? 'bg-surface-secondary' : 'bg-surface'}`}
                />
              </View>
              <View>
                <Label>State *</Label>
                <TextInput
                  value={form.state}
                  editable={!pinDone}
                  onChangeText={v => set({ state: v })}
                  placeholder="Auto-filled from PIN"
                  placeholderTextColor={t.foregroundMuted}
                  className={`${INPUT} ${pinDone ? 'bg-surface-secondary' : 'bg-surface'}`}
                />
              </View>

              {localities.length > 0 ? (
                <Select
                  label="Locality / Village"
                  value={form.address_line2}
                  placeholder="Select locality"
                  options={localities.map(l => ({ value: l, label: l }))}
                  onChange={v => set({ address_line2: v })}
                />
              ) : (
                <View>
                  <Label>Locality / Village</Label>
                  <TextInput
                    value={form.address_line2}
                    onChangeText={v => set({ address_line2: v })}
                    placeholder="Area, Colony, Village"
                    placeholderTextColor={t.foregroundMuted}
                    className={`${INPUT} bg-surface`}
                  />
                </View>
              )}

              <View>
                <Label>Landmark</Label>
                <TextInput
                  value={form.landmark}
                  onChangeText={v => set({ landmark: v })}
                  placeholder="Nearby landmark"
                  placeholderTextColor={t.foregroundMuted}
                  className={`${INPUT} bg-surface`}
                />
              </View>

              <Pressable onPress={() => set({ is_default: !form.is_default })} className="flex-row items-center gap-2">
                <View
                  className={`h-4 w-4 items-center justify-center rounded border ${form.is_default ? 'border-accent-600 bg-accent-600' : 'border-border-secondary bg-surface'}`}
                >
                  {form.is_default ? <Check size={12} color={status.white} strokeWidth={3} /> : null}
                </View>
                <Text className="text-sm text-foreground-secondary">Set as default address</Text>
              </Pressable>

              <View className="flex-row justify-end gap-3 pt-2">
                <Pressable onPress={onClose} disabled={saving} className="rounded-lg bg-surface-secondary px-5 py-2">
                  <Text className="font-medium text-foreground-secondary">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={submit}
                  disabled={saving}
                  className="flex-row items-center rounded-lg bg-accent-500 px-5 py-2 active:bg-accent-600 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <ActivityIndicator size="small" color={status.white} />
                      <Text className="ml-2 font-semibold text-white">Saving...</Text>
                    </>
                  ) : (
                    <Text className="font-semibold text-white">{editAddress ? 'Update Address' : 'Save Address'}</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </KeyboardScroll>
        </View>
      </View>
    </Modal>
  )
}
