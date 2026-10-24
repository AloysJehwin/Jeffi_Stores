import { useEffect, useState } from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { KeyboardAvoidingView } from 'react-native-keyboard-controller'
import { abandonSignup, acceptPolicies, phoneSendOtp, phoneVerifyOtp, updateProfile } from '../../api/account'
import { refreshUser } from './hooks'
import { DobInput, ErrorBox, isValidDob, Label, PhoneInput, PolicyConsent, PrimaryButton } from './ui'
import { useTokens } from '../../theme'

// Mirror of controller-service components/visitor/PhoneVerifyModal.tsx.

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
  const t = useTokens()
  const [stage, setStage] = useState<'phone' | 'otp'>('phone')
  const [phone, setPhone] = useState(initialPhone.replace(/\D/g, '').slice(-10))
  const [otp, setOtp] = useState('')
  const [dob, setDob] = useState('')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)

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
    <Modal visible transparent animationType="fade" onRequestClose={handleCancel}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-black/60 px-4">
          <ScrollView className="w-full" contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }} keyboardShouldPersistTaps="handled">
            <View className="bg-surface-elevated rounded-lg p-6 w-full" style={{ boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)' }}>
              <Text className="text-lg font-semibold text-foreground mb-2">
                {title || (stage === 'otp' ? 'Verify Mobile Number' : 'Add Mobile Number')}
              </Text>
              <Text className="text-sm text-foreground-secondary mb-6">
                {stage === 'otp'
                  ? `Enter the 6-digit code sent to +91 ${phone}.`
                  : `Add your mobile number${requiresPolicy ? ' and accept our policies' : ''} so we can keep you updated on your orders.`}
              </Text>

              <ErrorBox message={error} className="mb-4" />

              {stage === 'phone' ? (
                <View className="gap-4">
                  <View>
                    <Label>Mobile Number *</Label>
                    <PhoneInput value={phone} onChange={setPhone} autoFocus />
                    {phone.length > 0 && phone.length !== 10 && (
                      <Text className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</Text>
                    )}
                  </View>
                  {requiresDob && (
                    <View>
                      <Label>Date of Birth *</Label>
                      <DobInput value={dob} onChange={setDob} />
                    </View>
                  )}
                  {requiresPolicy && <PolicyConsent checked={policyAccepted} onChange={setPolicyAccepted} />}
                  <PrimaryButton
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
                    <Label>Enter OTP *</Label>
                    <TextInput
                      value={otp}
                      onChangeText={v => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                      keyboardType="number-pad"
                      maxLength={6}
                      autoFocus
                      textContentType="oneTimeCode"
                      autoComplete="sms-otp"
                      placeholder="000000"
                      placeholderTextColor={t.foregroundMuted}
                      className="w-full px-4 py-3 text-center border border-border-secondary rounded-lg bg-surface text-foreground"
                      style={{ letterSpacing: 8 }}
                    />
                  </View>
                  <PrimaryButton label="Verify & Continue" loadingLabel="Verifying..." loading={loading} disabled={otp.length !== 6} onPress={verifyOtp} />
                  <Pressable onPress={() => cooldown === 0 && sendOtp()} disabled={cooldown > 0 || loading}>
                    <Text className={`text-center text-sm ${cooldown > 0 || loading ? 'text-foreground-muted' : 'text-accent-600'}`}>
                      {cooldown > 0 ? `Resend OTP in ${cooldown}s` : 'Resend OTP'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setStage('phone')
                      setOtp('')
                      setError('')
                    }}
                  >
                    <Text className="text-center text-sm text-foreground-muted">Change number</Text>
                  </Pressable>
                </View>
              )}

              <Pressable onPress={handleCancel} disabled={loading} className="mt-4">
                <Text className="text-center text-sm text-foreground-muted">Cancel and sign out</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}
