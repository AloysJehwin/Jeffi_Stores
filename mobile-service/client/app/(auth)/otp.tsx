import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { loginWithOtp, requestOtp, type OtpChannel } from '../../src/api/auth'
import { updateProfile } from '../../src/api/account'
import { showToast } from '../../src/stores/toastStore'
import { AuthScreen } from '../../src/components/account/AuthScreen'
import { Button, FieldError, OtpField, Text, TextButton, type FieldRef } from '../../src/ui'
import { PolicyConsent } from '../../src/components/account/ui'
import { finishSignIn } from '../../src/components/account/authFlow'
import { useLeaveAuth } from '../../src/components/account/hooks'

// The code step of controller-service app/(auth)/login/page.tsx.

export default function OtpScreen() {
  const router = useRouter()
  const done = useLeaveAuth()
  const params = useLocalSearchParams<{ email: string; channel?: string; phone?: string; requiresPolicy?: string; cooldown?: string; error?: string }>()
  const email = params.email
  const channel = (params.channel as OtpChannel) || 'email'
  const loginPhone = params.phone || ''
  const requiresPolicy = params.requiresPolicy === '1'

  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(params.error || '')
  const [shake, setShake] = useState(0)
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(Number(params.cooldown) || 0)
  const inputRef = useRef<FieldRef>(null)
  const submittedRef = useRef('')

  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [resendCooldown])

  const submitLogin = async (otpValue: string) => {
    if (submittedRef.current === otpValue) return
    if (requiresPolicy && !policyAccepted) return
    submittedRef.current = otpValue
    setError('')
    setIsLoading(true)
    try {
      const result = await loginWithOtp(email, otpValue, requiresPolicy ? { policiesAccepted: policyAccepted } : {})
      if (result.isNewUser) {
        router.replace({ pathname: '/(auth)/signup', params: { email, from: 'login' } })
        return
      }
      if (!result.user) throw new Error('Login failed')
      await finishSignIn(result.user, result.token)
      // Channel preference (+ phone for SMS/WhatsApp), non-blocking like the web.
      updateProfile({
        notificationChannel: channel,
        ...(channel !== 'email' && loginPhone.length === 10 ? { phone: loginPhone } : {}),
      }).catch(() => {})
      done()
    } catch (err: any) {
      setError(err?.message || 'Invalid code. Please try again.')
      setShake(n => n + 1)
      setOtp('')
      submittedRef.current = ''
      setTimeout(() => inputRef.current?.focus(), 0)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (otp.length !== 6 || isLoading) return
    if (requiresPolicy && !policyAccepted) return
    submitLogin(otp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, isLoading, requiresPolicy, policyAccepted])

  const handleResend = async () => {
    setError('')
    setOtp('')
    submittedRef.current = ''
    setIsLoading(true)
    try {
      const res = await requestOtp({ email, phone: loginPhone ? `+91${loginPhone}` : undefined, channel, isSignup: false })
      if (!res.ok) {
        if (res.status === 429 && typeof res.data.retryAfter === 'number') setResendCooldown(res.data.retryAfter)
        throw new Error(res.data.error || 'Failed to resend the code')
      }
      setResendCooldown(typeof res.data.nextCooldown === 'number' ? res.data.nextCooldown : 60)
      showToast('New code sent', 'success')
      setTimeout(() => inputRef.current?.focus(), 0)
    } catch (err: any) {
      setError(err?.message || 'Failed to resend the code')
    } finally {
      setIsLoading(false)
    }
  }

  const where =
    channel === 'email' ? email : `+91 ••••• ${loginPhone.slice(-4)} on ${channel === 'sms' ? 'SMS' : 'WhatsApp'}`

  return (
    <AuthScreen title="Enter the code" subtitle={`We sent a 6-digit code to ${where}.`}>
      <View className="gap-5">
        <View>
          <OtpField value={otp} onChange={setOtp} inputRef={inputRef} shake={shake} />
          <FieldError message={error} />
        </View>

        <View className="flex-row items-center justify-between">
          <TextButton
            label={resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
            tone={resendCooldown > 0 || isLoading ? 'muted' : 'accent'}
            onPress={() => {
              if (!isLoading && resendCooldown <= 0) handleResend()
            }}
          />
          <TextButton label={channel === 'email' ? 'Change email' : 'Change number'} tone="muted" onPress={() => router.back()} />
        </View>

        {requiresPolicy && <PolicyConsent checked={policyAccepted} onChange={setPolicyAccepted} />}

        <Button
          label="Verify"
          loadingLabel="Verifying…"
          loading={isLoading}
          disabled={otp.length !== 6 || (requiresPolicy && !policyAccepted)}
          onPress={() => otp.length === 6 && submitLogin(otp)}
        />

        <Text className="text-center text-sm text-foreground-secondary">
          New here?{' '}
          <Text accessibilityRole="link" className="font-semibold text-accent-600 dark:text-accent-400" onPress={() => router.replace('/(auth)/signup')}>
            Create an account
          </Text>
        </Text>
      </View>
    </AuthScreen>
  )
}
