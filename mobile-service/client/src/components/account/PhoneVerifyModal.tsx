import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { abandonSignup, acceptPolicies, phoneSendOtp, phoneVerifyOtp, updateProfile } from '../../api/account'
import { refreshUser } from './hooks'
import { DobInput, isValidDob, PolicyConsent } from './ui'
import { Button, Label, ModalSheet, Notice, OtpField, PhoneField, SheetHeader, Text, TextButton } from '../../ui'

// Mirror of controller-service components/visitor/PhoneVerifyModal.tsx, as a sheet. It's a required
// step, so only "Cancel" (or the back button) closes it.

export default function PhoneVerifyModal({
  requiresPolicy = false,
  requiresDob = false,
  title,
  initialPhone = '',
  abandonOnCancel = false,
  onVerified,
  onCancel,
}: {
  requiresPolicy?: boolean
  requiresDob?: boolean
  title?: string
  initialPhone?: string
  abandonOnCancel?: boolean
  onVerified: () => void
  onCancel: () => void
}) {
  const [stage, setStage] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState(initialPhone.replace(/\D/g, '').slice(-10))
  const [otp, setOtp] = useState('')
  const [dob, setDob] = useState('')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [sentVia, setSentVia] = useState<'whatsapp' | 'sms' | 'email'>('whatsapp')

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  async function handleCancel() {
    if (abandonOnCancel) await abandonSignup()
    onCancel()
  }

  async function sendOtp() {
    setError('')
    if (phone.length !== 10) return setError('Enter a valid 10-digit mobile number')
    if (requiresPolicy && !policyAccepted) return setError('Please accept the Privacy Policy and Terms & Conditions')
    if (requiresDob && !isValidDob(dob)) return setError('Enter a valid date of birth')
    setLoading(true)
    try {
      const res = await phoneSendOtp(phone)
      if (!res.ok) {
        if (res.status === 429 && typeof res.data.retryAfter === 'number') setCooldown(res.data.retryAfter)
        throw new Error(res.data.error || 'Failed to send OTP')
      }
      setSentVia(res.data.channel === 'sms' || res.data.channel === 'email' ? res.data.channel : 'whatsapp')
      setStage('otp')
      setCooldown(typeof res.data.nextCooldown === 'number' ? res.data.nextCooldown : 30)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function verifyOtp() {
    setError('')
    if (otp.length !== 6) return setError('Enter the 6-digit OTP')
    setLoading(true)
    try {
      const res = await phoneVerifyOtp(phone, otp)
      if (!res.ok) throw new Error(res.data.error || 'Failed to verify OTP')
      if (requiresPolicy && policyAccepted) await acceptPolicies()
      if (requiresDob) await updateProfile({ dateOfBirth: dob }).catch((e: Error) => {
        throw new Error(e.message || 'Failed to save date of birth')
      })
      await refreshUser()
      onVerified()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ModalSheet open onClose={handleCancel} dismissible={false}>
      <SheetHeader
        title={title || (stage === 'otp' ? 'Verify Mobile Number' : 'Add Mobile Number')}
        subtitle={
          stage === 'otp'
            ? sentVia === 'email'
              ? `Enter the 6-digit code we emailed you to verify +91 ${phone}.`
              : `Enter the 6-digit code sent ${sentVia === 'whatsapp' ? 'on WhatsApp' : 'by SMS'} to +91 ${phone}.`
            : `Add your mobile number${requiresPolicy ? ' and accept our policies' : ''} so we can keep you updated on your orders.`
        }
      />

      {!!error && (
        <Notice tone="danger" className="mb-4">
          {error}
        </Notice>
      )}

      {stage === 'phone' ? (
        <View className="gap-4">
          <PhoneField
            label="Mobile Number"
            required
            value={phone}
            onChange={setPhone}
            autoFocus
            error={phone.length > 0 && phone.length !== 10 ? 'Enter a valid 10-digit mobile number' : null}
          />
          {requiresDob && <DobInput label="Date of Birth" required value={dob} onChange={setDob} />}
          {requiresPolicy && <PolicyConsent checked={policyAccepted} onChange={setPolicyAccepted} />}
          <Button
            label="Send OTP"
            loadingLabel="Sending..."
            loading={loading}
            disabled={phone.length !== 10 || (requiresPolicy && !policyAccepted) || (requiresDob && !isValidDob(dob))}
            onPress={sendOtp}
          />
        </View>
      ) : (
        <View className="gap-4">
          <View>
            <Label required>Enter OTP</Label>
            <OtpField value={otp} onChange={setOtp} />
          </View>
          <Button label="Verify & Continue" loadingLabel="Verifying..." loading={loading} disabled={otp.length !== 6} onPress={verifyOtp} />
          <View className="flex-row items-center justify-between gap-3">
            {cooldown > 0 || loading ? (
              <Text className="py-1 text-sm text-foreground-muted">{cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}</Text>
            ) : (
              <TextButton label="Resend OTP" onPress={sendOtp} />
            )}
            <TextButton
              label="Change number"
              tone="muted"
              onPress={() => {
                setStage('phone')
                setOtp('')
                setError('')
              }}
            />
          </View>
        </View>
      )}

      <View className="mt-3">
        <Button label="Cancel and sign out" variant="ghost" size="md" disabled={loading} onPress={handleCancel} />
      </View>
    </ModalSheet>
  )
}
