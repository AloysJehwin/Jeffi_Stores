import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, View } from 'react-native'
import { Text } from '../../ui'
import { Image } from 'expo-image'
import * as SecureStore from 'expo-secure-store'
import { updateProfile } from '../../api/account'
import { showToast } from '../../stores/toastStore'
import { refreshUser, useAccountUser, useFeatureFlags } from './hooks'
import { DobInput, Input, isValidDob, PhoneInput } from './ui'
import PhoneVerifyModal from './PhoneVerifyModal'

// The "Profile" card of controller-service app/(storefront)/account/page.tsx (view + inline edit).

const NUDGE_KEY = 'dobNudgeDismissed'

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between">
      <Text className="text-xs text-foreground-muted">{label}</Text>
      <Text className="text-xs font-medium text-foreground">{value}</Text>
    </View>
  )
}

export default function ProfileCard({ initialEditing = false }: { initialEditing?: boolean }) {
  const user = useAccountUser()
  const { birthdayEnabled } = useFeatureFlags()
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
  const [nudgeDismissed, setNudgeDismissed] = useState(true)

  useEffect(() => {
    SecureStore.getItemAsync(NUDGE_KEY)
      .then(v => setNudgeDismissed(v === '1'))
      .catch(() => setNudgeDismissed(false))
  }, [])

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
    <View className="bg-surface-elevated rounded-xl border border-border-default p-4">
      <View className="flex-row items-center justify-between mb-4">
        <Text className="text-sm font-semibold text-foreground">Profile</Text>
        {!isEditing && (
          <Pressable onPress={() => setIsEditing(true)} className="px-2.5 py-1 rounded-lg border border-accent-200 dark:border-accent-800">
            <Text className="text-xs text-accent-600 dark:text-accent-400 font-medium">Edit</Text>
          </Pressable>
        )}
      </View>

      {birthdayEnabled && !isEditing && !user.dateOfBirth && !nudgeDismissed && (
        <View className="mb-3 p-2.5 rounded-lg bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800 flex-row items-start justify-between gap-2">
          <Text className="flex-1 text-xs text-accent-700 dark:text-accent-300" onPress={() => setIsEditing(true)}>
            Add your date of birth so we can send you a birthday treat.
          </Text>
          <Text
            className="text-xs text-accent-500 font-medium"
            onPress={() => {
              setNudgeDismissed(true)
              SecureStore.setItemAsync(NUDGE_KEY, '1').catch(() => {})
            }}
          >
            Dismiss
          </Text>
        </View>
      )}

      {!!message && (
        <View className={`mb-3 p-2.5 rounded-lg ${message.includes('success') ? 'bg-green-50 dark:bg-green-900/30' : 'bg-red-50 dark:bg-red-900/30'}`}>
          <Text className={`text-xs ${message.includes('success') ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{message}</Text>
        </View>
      )}

      {!isEditing ? (
        <View className="gap-2.5">
          <View className="flex-row items-center gap-3">
            <View className="w-10 h-10 rounded-xl overflow-hidden">
              {user.avatarUrl ? (
                <Image source={{ uri: user.avatarUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              ) : (
                <View className="w-full h-full bg-accent-100 dark:bg-accent-900/40 items-center justify-center">
                  <Text className="text-lg font-bold text-accent-600 dark:text-accent-400">{user.firstName?.[0]?.toUpperCase() || 'U'}</Text>
                </View>
              )}
            </View>
            <View className="flex-1">
              <Text className="font-semibold text-foreground text-sm">
                {user.firstName} {user.lastName}
              </Text>
              <Text className="text-xs text-foreground-muted" numberOfLines={1}>
                {user.email}
              </Text>
            </View>
          </View>
          <View className="pt-2 border-t border-border-default gap-2">
            <Row label="Phone" value={user.phone ? (user.phone.startsWith('+91') ? user.phone : `+91 ${user.phone}`) : '—'} />
            <Row label="Date of Birth" value={dobText} />
            <Row label="Member since" value={memberSince} />
          </View>
        </View>
      ) : (
        <View className="gap-3">
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Text className="text-xs font-medium text-foreground-secondary mb-1">First Name *</Text>
              <Input dense value={formData.firstName} onChangeText={v => setFormData({ ...formData, firstName: v })} autoCapitalize="words" />
            </View>
            <View className="flex-1">
              <Text className="text-xs font-medium text-foreground-secondary mb-1">Last Name</Text>
              <Input dense value={formData.lastName} onChangeText={v => setFormData({ ...formData, lastName: v })} autoCapitalize="words" />
            </View>
          </View>
          <View>
            <Text className="text-xs font-medium text-foreground-secondary mb-1">Phone</Text>
            <PhoneInput dense value={formData.phone} onChange={v => setFormData({ ...formData, phone: v })} />
          </View>
          <View>
            <Text className="text-xs font-medium text-foreground-secondary mb-1">Date of Birth</Text>
            <DobInput dense value={formData.dob} onChange={v => setFormData({ ...formData, dob: v })} />
            {formData.dob.length > 0 && !isValidDob(formData.dob) && <Text className="mt-1 text-xs text-red-500">Enter a valid date of birth</Text>}
          </View>
          <View className="flex-row gap-2 pt-1">
            <Pressable
              onPress={handleSave}
              disabled={isSaving}
              className={`flex-1 py-2 rounded-lg flex-row items-center justify-center ${isSaving ? 'bg-accent-300' : 'bg-accent-500'}`}
            >
              {isSaving && <ActivityIndicator size="small" color="white" style={{ marginRight: 6, transform: [{ scale: 0.7 }] }} />}
              <Text className="text-white font-semibold text-xs">{isSaving ? 'Saving...' : 'Save'}</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setIsEditing(false)
                setMessage('')
                setFormData(blank())
              }}
              disabled={isSaving}
              className={`flex-1 py-2 bg-surface-secondary rounded-lg items-center ${isSaving ? 'opacity-50' : ''}`}
            >
              <Text className="text-foreground-secondary font-semibold text-xs">Cancel</Text>
            </Pressable>
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
    </View>
  )
}
