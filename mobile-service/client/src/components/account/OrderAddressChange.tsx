import { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { listAddresses } from '../../api/addresses'
import { requestAddressChange, withdrawAddressChange, type AddressChangeInfo, type AddressLike } from '../../api/account'
import type { Address } from '../../types'
import HeroIcon from './HeroIcon'
import { AddressFormModal } from './AddressForm'
import { accent, useTokens } from '../../theme'

// Mirror of controller-service components/shared/OrderAddressChange.tsx.

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
const MATCH_FIELDS: (keyof AddressLike)[] = ['full_name', 'address_line1', 'address_line2', 'landmark', 'city', 'state', 'postal_code', 'phone']
const isSame = (a: AddressLike, b: AddressLike | null) => !!b && MATCH_FIELDS.every(f => norm(a[f]) === norm(b[f]))

function AddressLines({ a }: { a: AddressLike }) {
  return (
    <>
      <Text className="font-semibold text-foreground">{a.full_name}</Text>
      <Text className="text-sm text-foreground-secondary">
        {a.address_line1}
        {a.address_line2 ? `, ${a.address_line2}` : ''}
      </Text>
      {!!a.landmark && <Text className="text-sm text-foreground-secondary">Landmark: {a.landmark}</Text>}
      <Text className="text-sm text-foreground-secondary">
        {a.city}, {a.state} {a.postal_code}
      </Text>
      <Text className="text-sm text-foreground-secondary">Phone: {a.phone}</Text>
    </>
  )
}

export default function OrderAddressChange({
  orderId,
  canChange,
  request,
  currentAddress,
  onChanged,
}: {
  orderId: string
  canChange: boolean
  request: AddressChangeInfo | null
  currentAddress: AddressLike | null
  onChanged: () => void
}) {
  const t = useTokens()
  const [open, setOpen] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [addresses, setAddresses] = useState<Address[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = request?.status === 'pending'

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelectedId(null)
    listAddresses()
      .then(a => !cancelled && setAddresses(a))
      .catch((e: any) => !cancelled && setError(e?.message || 'Could not load your saved addresses'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [open])

  const submit = async () => {
    if (!selectedId) return
    setBusy(true)
    setError(null)
    try {
      await requestAddressChange(orderId, selectedId)
      setOpen(false)
      onChanged()
    } catch (e: any) {
      setError(e?.message || 'Could not submit your request')
    } finally {
      setBusy(false)
    }
  }

  const withdraw = async () => {
    setBusy(true)
    setError(null)
    try {
      await withdrawAddressChange(orderId)
      onChanged()
    } catch (e: any) {
      setError(e?.message || 'Could not withdraw your request')
    } finally {
      setBusy(false)
    }
  }

  if (!pending && !canChange) return null

  return (
    <View className="mt-4 pt-4 border-t border-border-default">
      {pending && request ? (
        <View className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 p-3">
          <Text className="text-sm font-semibold text-amber-900 dark:text-amber-300">Address change requested</Text>
          <Text className="text-xs text-amber-800 dark:text-amber-300 mt-0.5 mb-2">
            Waiting for the store to approve. Your order ships to the new address only after approval.
          </Text>
          <AddressLines a={request.newAddress} />
          {canChange && (
            <Pressable onPress={withdraw} disabled={busy} className="mt-3 self-start">
              <Text className={`text-sm font-medium text-amber-900 dark:text-amber-300 underline ${busy ? 'opacity-50' : ''}`}>
                {busy ? 'Withdrawing...' : 'Withdraw request'}
              </Text>
            </Pressable>
          )}
        </View>
      ) : (
        <>
          {request?.status === 'rejected' && (
            <Text className="text-sm text-red-700 dark:text-red-400 mb-3">
              Your address change request was declined{request.adminNotes ? `: ${request.adminNotes}` : '.'}
            </Text>
          )}
          <Pressable onPress={() => setOpen(true)} className="self-start">
            <Text className="text-sm font-medium text-accent-600">Change delivery address</Text>
          </Pressable>
        </>
      )}
      {!!error && !open && <Text className="text-sm text-red-600 dark:text-red-400 mt-2">{error}</Text>}

      <Modal visible={open && !showAddForm} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 items-center justify-center p-4 bg-black/30">
          <View className="bg-surface-elevated rounded-lg w-full" style={{ maxHeight: '90%' }}>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-lg font-bold text-foreground">Change Delivery Address</Text>
                <Pressable onPress={() => setOpen(false)} accessibilityLabel="Close" className="p-1">
                  <HeroIcon name="x" size={20} color={t.foregroundMuted} />
                </Pressable>
              </View>
              <Text className="text-sm text-foreground-secondary mb-4">
                Pick one of your saved addresses. The store reviews the request, and the address changes only after it is approved.
              </Text>
              {loading ? (
                <View className="items-center py-10">
                  <ActivityIndicator color={accent[500]} />
                </View>
              ) : addresses.length === 0 ? (
                <Text className="text-foreground-secondary text-sm text-center py-6">No saved addresses found.</Text>
              ) : (
                <View className="gap-3">
                  {addresses.map(address => {
                    const current = isSame(address, currentAddress)
                    const selected = selectedId === address.id
                    return (
                      <Pressable
                        key={address.id}
                        disabled={current}
                        onPress={() => setSelectedId(address.id)}
                        className={`flex-row items-start gap-4 p-4 border-2 rounded-lg ${
                          current ? 'border-border-default opacity-60' : selected ? 'border-accent-500 bg-accent-50 dark:bg-accent-900/30' : 'border-border-default'
                        }`}
                      >
                        <View className={`mt-1 w-4 h-4 rounded-full border-2 items-center justify-center ${selected ? 'border-accent-600' : 'border-border-secondary'}`}>
                          {selected && <View className="w-2 h-2 rounded-full bg-accent-600" />}
                        </View>
                        <View className="flex-1">
                          <View className="flex-row items-center gap-2 mb-1 flex-wrap">
                            {current && (
                              <View className="bg-surface-secondary px-2 py-0.5 rounded">
                                <Text className="text-xs text-foreground-secondary">Current delivery address</Text>
                              </View>
                            )}
                            {address.is_default && (
                              <View className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded">
                                <Text className="text-xs text-green-800 dark:text-green-300">Default</Text>
                              </View>
                            )}
                            <View className="bg-surface-secondary px-2 py-0.5 rounded">
                              <Text className="text-xs text-foreground-secondary capitalize">{address.address_type}</Text>
                            </View>
                          </View>
                          <AddressLines a={address} />
                        </View>
                      </Pressable>
                    )
                  })}
                </View>
              )}
              <Pressable onPress={() => setShowAddForm(true)} className="mt-4 self-start">
                <Text className="text-sm font-medium text-accent-600">+ Add new address</Text>
              </Pressable>
              {!!error && <Text className="text-sm text-red-600 dark:text-red-400 mt-3">{error}</Text>}
              <View className="flex-row gap-3 mt-6">
                <Pressable onPress={submit} disabled={!selectedId || busy} className={`flex-1 bg-accent-500 px-4 py-2 rounded-lg items-center ${!selectedId || busy ? 'opacity-50' : ''}`}>
                  <Text className="text-white font-medium">{busy ? 'Submitting...' : 'Request Change'}</Text>
                </Pressable>
                <Pressable onPress={() => setOpen(false)} disabled={busy} className="px-4 py-2 rounded-lg border border-border-secondary">
                  <Text className="font-medium text-foreground-secondary">Cancel</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <AddressFormModal
        isOpen={showAddForm}
        onClose={() => setShowAddForm(false)}
        onSaved={address => {
          setAddresses(prev => [address, ...prev.filter(a => a.id !== address.id)])
          setSelectedId(address.id)
          setShowAddForm(false)
        }}
      />
    </View>
  )
}
