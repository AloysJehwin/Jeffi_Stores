import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Clock } from 'lucide-react-native'
import { listAddresses } from '../../api/addresses'
import { requestAddressChange, withdrawAddressChange, type AddressChangeInfo, type AddressLike } from '../../api/account'
import type { Address } from '../../types'
import { AddAddressSheet } from './AddressSheet'
import { Badge, BodySmall, Button, Divider, FieldError, ModalSheet, Notice, Radio, Skeleton, Text, TextButton } from '../../ui'

// Mirror of controller-service components/shared/OrderAddressChange.tsx.

const norm = (v: unknown) => String(v ?? '').trim().toLowerCase()
const MATCH_FIELDS: (keyof AddressLike)[] = ['full_name', 'address_line1', 'address_line2', 'landmark', 'city', 'state', 'postal_code', 'phone']
const isSame = (a: AddressLike, b: AddressLike | null) => !!b && MATCH_FIELDS.every(f => norm(a[f]) === norm(b[f]))

function AddressLines({ a, name = true }: { a: AddressLike; name?: boolean }) {
  return (
    <>
      {name ? <Text className="font-semibold text-foreground">{a.full_name}</Text> : null}
      <BodySmall>
        {a.address_line1}
        {a.address_line2 ? `, ${a.address_line2}` : ''}
      </BodySmall>
      {!!a.landmark && <BodySmall>Landmark: {a.landmark}</BodySmall>}
      <BodySmall>
        {a.city}, {a.state} {a.postal_code}
      </BodySmall>
      <BodySmall>Phone: {a.phone}</BodySmall>
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
    <View className="mt-4">
      <Divider className="mb-4" />
      {pending && request ? (
        <Notice tone="warning" icon={Clock} title="Address change requested">
          <Text className="mb-2 mt-0.5 text-[13px] leading-[18px] text-foreground-secondary">
            Waiting for the store to approve. Your order ships to the new address only after approval.
          </Text>
          <AddressLines a={request.newAddress} />
          {canChange && (
            <View className="mt-3">
              <Button label="Withdraw request" loading={busy} loadingLabel="Withdrawing..." variant="outline" size="sm" block={false} onPress={withdraw} />
            </View>
          )}
        </Notice>
      ) : (
        <>
          {request?.status === 'rejected' && (
            <Text className="mb-3 text-sm text-red-700 dark:text-red-400">
              Your address change request was declined{request.adminNotes ? `: ${request.adminNotes}` : '.'}
            </Text>
          )}
          <TextButton label="Change delivery address" onPress={() => setOpen(true)} />
        </>
      )}
      {!open && <FieldError message={error} />}

      <ModalSheet
        open={open && !showAddForm}
        onClose={() => setOpen(false)}
        title="Change Delivery Address"
        subtitle="Pick one of your saved addresses. The store reviews the request, and the address changes only after it is approved."
        footer={<Button label="Request Change" loading={busy} loadingLabel="Submitting..." disabled={!selectedId} onPress={submit} />}
      >
        {loading ? (
          <View className="gap-3">
            {[0, 1].map(i => (
              <View key={i} className="flex-row gap-3 rounded-panel border-2 border-border-default p-4">
                <Skeleton width={22} height={22} rounded="rounded-full" />
                <View className="flex-1 gap-2">
                  <Skeleton height={20} width={110} rounded="rounded-full" />
                  <Skeleton height={14} width="50%" />
                  <Skeleton height={12} width="85%" />
                  <Skeleton height={12} width="60%" />
                </View>
              </View>
            ))}
          </View>
        ) : addresses.length === 0 ? (
          <Text className="py-6 text-center text-sm text-foreground-secondary">No saved addresses found.</Text>
        ) : (
          <View className="gap-3">
            {addresses.map(address => {
              const current = isSame(address, currentAddress)
              return (
                <Radio key={address.id} card selected={selectedId === address.id} disabled={current} onSelect={() => setSelectedId(address.id)} label={address.full_name}>
                  <View className="my-1.5 flex-row flex-wrap gap-1.5">
                    {current && <Badge label="Current delivery address" size="sm" />}
                    {address.is_default && <Badge label="Default" tone="success" size="sm" />}
                    <Badge label={address.address_type.charAt(0).toUpperCase() + address.address_type.slice(1)} size="sm" />
                  </View>
                  <AddressLines a={address} name={false} />
                </Radio>
              )
            })}
          </View>
        )}
        <TextButton label="+ Add new address" onPress={() => setShowAddForm(true)} className="mt-4" />
        <FieldError message={error} className="mt-3" />
      </ModalSheet>

      <AddAddressSheet
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
