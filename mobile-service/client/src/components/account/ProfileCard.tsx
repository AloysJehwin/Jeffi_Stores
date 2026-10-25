import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Image } from 'expo-image'
import * as SecureStore from 'expo-secure-store'
import { Pencil } from 'lucide-react-native'
import { updateProfile } from '../../api/account'
import { showToast } from '../../stores/toastStore'
import { refreshUser, useAccountUser, useFeatureFlags } from './hooks'
import { DobInput, isValidDob } from './ui'
import PhoneVerifyModal from './PhoneVerifyModal'
import { Button, Card, Divider, Heading, Notice, PhoneField, Text, TextButton, TextField } from '../../ui'

// The "Profile" card of controller-service app/(storefront)/account/page.tsx (view + inline edit).

const NUDGE_KEY = 'dobNudgeDismissed'

/** The birthday nudge: shown when birthdays are on, no DOB is saved and it hasn't been dismissed. */
export function useDobNudge() {
  const user = useAccountUser()
  const { birthdayEnabled } = useFeatureFlags()
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => {
    SecureStore.getItemAsync(NUDGE_KEY)
      .then(v => setDismissed(v === '1'))
      .catch(() => setDismissed(false))
  }, [])
  return {
    show: birthdayEnabled && !!user && !user.dateOfBirth && !dismissed,
    dismiss: () => {
      setDismissed(true)
      SecureStore.setItemAsync(NUDGE_KEY, '1').catch(() => {})
    },
  }
}

/** "Add your date of birth…" with a Dismiss link. */
export function DobNudge({ onAdd, onDismiss, className }: { onAdd: () => void; onDismiss: () => void; className?: string }) {
  return (
    <Notice className={className}>
      <Text accessibilityRole="button" className="text-sm leading-5 text-accent-800 dark:text-accent-200" onPress={onAdd}>
        Add your date of birth so we can send you a birthday treat.
      </Text>
      <TextButton label="Dismiss" onPress={onDismiss} className="mt-1" />
    </Notice>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-3">
      <Text className="text-sm text-foreground-muted">{label}</Text>
      <Text className="text-sm font-semibold text-foreground">{value}</Text>
    </View>
  )
}

export default function ProfileCard({ initialEditing = false }: { initialEditing?: boolean }) {
  const user = useAccountUser()
  const nudge = useDobNudge()
  const blank = () => ({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    phone: (user?.phone || '').replace(/^\+91/, ''),
    dob: user?.dateOfBirth || '',
  })
  const [isEditing, setIsEditing] = useState(initialEditing)
  const [formData, setFormData] = useState(blank)
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showPhoneVerify, setShowPhoneVerify] = useState(false)

  useEffect(() => {
    if (!isEditing) setFormData(blank())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  if (!user) return null

  const handleSave = async () => {
    if (!formData.firstName.trim()) return setMessage('First name is required')
    if (formData.phone && formData.phone.length !== 10) return setMessage('Enter a valid 10-digit mobile number')
    if (formData.dob && !isValidDob(formData.dob)) return setMessage('Enter a valid date of birth')
    const currentPhone = (user.phone || '').replace(/^\+91/, '')
    const phoneNeedsVerify = !!formData.phone && (formData.phone !== currentPhone || !user.phoneVerified)
    setIsSaving(true)
    setMessage('')
    try {
      // Name and DOB save directly; a new/changed number is verified by OTP (the verify route stores it).
      const payload: Record<string, string> = { firstName: formData.firstName.trim() }
      if (formData.lastName.trim()) payload.lastName = formData.lastName.trim()
      if (formData.dob && formData.dob !== (user.dateOfBirth || '')) payload.dateOfBirth = formData.dob
      await updateProfile(payload)
      if (phoneNeedsVerify) {
        setShowPhoneVerify(true)
        return
      }
      showToast('Profile updated successfully!', 'success')
      setIsEditing(false)
      await refreshUser()
    } catch {
      showToast('Failed to update profile', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const dobText = user.dateOfBirth
    ? new Date(user.dateOfBirth).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '—'
  const memberSince = user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'

  return (
    <Card>
      <View className="mb-4 flex-row items-center justify-between">
        <Heading>Profile</Heading>
        {!isEditing && <Button label="Edit" icon={Pencil} variant="secondary" size="sm" block={false} onPress={() => setIsEditing(true)} />}
      </View>

      {!isEditing && nudge.show && <DobNudge className="mb-3" onAdd={() => setIsEditing(true)} onDismiss={nudge.dismiss} />}

      {!!message && (
        <Notice tone={message.includes('success') ? 'success' : 'danger'} className="mb-3">
          {message}
        </Notice>
      )}

      {!isEditing ? (
        <View className="gap-3">
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 overflow-hidden rounded-xl">
              {user.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <View className="h-full w-full items-center justify-center bg-accent-100 dark:bg-accent-900/40">
                  <Text className="text-lg font-bold text-accent-600 dark:text-accent-400">{user.firstName?.[0]?.toUpperCase() || 'U'}</Text>
                </View>
              )}
            </View>
            <View className="flex-1">
              <Text className="text-[15px] font-semibold text-foreground">
                {user.firstName} {user.lastName}
              </Text>
              <Text className="text-[13px] text-foreground-muted" numberOfLines={1}>
                {user.email}
              </Text>
            </View>
          </View>
          <Divider />
          <View className="gap-2.5">
            <Row label="Phone" value={user.phone ? (user.phone.startsWith('+91') ? user.phone : `+91 ${user.phone}`) : '—'} />
            <Row label="Date of Birth" value={dobText} />
            <Row label="Member since" value={memberSince} />
          </View>
        </View>
      ) : (
        <View className="gap-4">
          <TextField label="First Name" required value={formData.firstName} onChangeText={v => setFormData({ ...formData, firstName: v })} autoCapitalize="words" />
          <TextField label="Last Name" value={formData.lastName} onChangeText={v => setFormData({ ...formData, lastName: v })} autoCapitalize="words" />
          <PhoneField label="Phone" value={formData.phone} onChange={v => setFormData({ ...formData, phone: v })} />
          <DobInput
            label="Date of Birth"
            value={formData.dob}
            onChange={v => setFormData({ ...formData, dob: v })}
            error={formData.dob.length > 0 && !isValidDob(formData.dob) ? 'Enter a valid date of birth' : null}
          />
          <View className="flex-row gap-3 pt-1">
            <View className="flex-1">
              <Button
                label="Cancel"
                variant="secondary"
                size="md"
                disabled={isSaving}
                onPress={() => {
                  setIsEditing(false)
                  setMessage('')
                  setFormData(blank())
                }}
              />
            </View>
            <View className="flex-1">
              <Button label="Save" loadingLabel="Saving..." loading={isSaving} size="md" onPress={handleSave} />
            </View>
          </View>
        </View>
      )}

      {showPhoneVerify && (
        <PhoneVerifyModal
          title="Verify Mobile Number"
          initialPhone={formData.phone}
          onVerified={() => {
            setShowPhoneVerify(false)
            setIsEditing(false)
            refreshUser()
          }}
          onCancel={() => {
            setShowPhoneVerify(false)
            showToast('Mobile number not verified. Your name was saved.', 'info')
            refreshUser()
          }}
        />
      )}
    </Card>
  )
}
