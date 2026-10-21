import { useEffect, useRef, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { loginWithOtp, requestOtp, type OtpChannel } from '../../src/api/auth'
import { updateProfile } from '../../src/api/account'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { showToast } from '../../src/stores/toastStore'
import { AuthShell, OtpField, SentNote } from '../../src/components/account/AuthShell'
import { ErrorBox, Label, PolicyConsent, PrimaryButton } from '../../src/components/account/ui'
import { finishSignIn } from '../../src/components/account/authFlow'

// Mirror of the code step of controller-service app/(auth)/login/page.tsx.

export default function OtpScreen() {
  const router = useRouter()
  const config = useStoreConfig()
  const params = useLocalSearchParams<{ email: string; channel?: string; phone?: string; requiresPolicy?: string; cooldown?: string; error?: string }>()
  const email = params.email
  const channel = (params.channel as OtpChannel) || 'email'
  const loginPhone = params.phone || ''
  const requiresPolicy = params.requiresPolicy === '1'

  const [otp, setOtp] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(params.error || '')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(Number(params.cooldown) || 0)
  const inputRef = useRef<TextInput>(null)
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
      router.dismissAll()
    } catch (err: any) {
      setError(err?.message || 'Invalid OTP. Please try again.')
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
        throw new Error(res.data.error || 'Failed to resend OTP')
      }
      setResendCooldown(typeof res.data.nextCooldown === 'number' ? res.data.nextCooldown : 60)
      showToast('New OTP sent! Check your inbox for the latest code.', 'success')
      setTimeout(() => inputRef.current?.focus(), 0)
    } catch (err: any) {
      setError(err?.message || 'Failed to resend OTP')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthShell title="Welcome Back" subtitle={`Login to your ${config.identity.name || 'Jeffi Stores'} account`}>
      <ErrorBox message={error} />
      <View className="gap-6">
        <SentNote>
          {channel === 'email' ? (
            <>
              We&apos;ve sent a 6-digit verification code to <Text className="font-bold">{email}</Text>
            </>
          ) : (
            <>
              We&apos;ve sent a 6-digit verification code via {channel === 'sms' ? 'SMS' : 'WhatsApp'} to{' '}
              <Text className="font-bold">+91 ••••• {loginPhone.slice(-4)}</Text>
            </>
          )}
        </SentNote>

        <View>
          <Label>Verification Code</Label>
          <OtpField value={otp} onChange={setOtp} inputRef={inputRef} />
        </View>

        <View className="flex-row items-center justify-between">
          <Pressable onPress={handleResend} disabled={isLoading || resendCooldown > 0}>
            <Text className={`text-sm font-medium text-accent-600 dark:text-accent-400 ${isLoading || resendCooldown > 0 ? 'opacity-50' : ''}`}>
              {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
            </Text>
          </Pressable>
          <Pressable onPress={() => router.back()}>
            <Text className="text-sm text-foreground-secondary">Change Channel</Text>
          </Pressable>
        </View>

        {requiresPolicy && <PolicyConsent checked={policyAccepted} onChange={setPolicyAccepted} />}

        <PrimaryButton
          label="Login"
          loadingLabel="Logging in..."
          loading={isLoading}
          disabled={otp.length !== 6 || (requiresPolicy && !policyAccepted)}
          onPress={() => otp.length === 6 && submitLogin(otp)}
        />
      </View>

      <Text className="mt-6 text-center text-sm text-foreground-secondary">
        Don&apos;t have an account?{' '}
        <Text className="text-accent-600 dark:text-accent-400 font-medium" onPress={() => router.replace('/(auth)/signup')}>
          Create one
        </Text>
      </Text>
    </AuthShell>
  )
}
