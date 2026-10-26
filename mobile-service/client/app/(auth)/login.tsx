import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { googleAuth, googleSignInIdToken, GOOGLE_WEB_CLIENT_ID, requestOtp, type OtpChannel } from '../../src/api/auth'
import { AuthScreen, GoogleRow, TermsNote } from '../../src/components/account/AuthScreen'
import { ChannelChips } from '../../src/components/account/ChannelChips'
import { useFeatureFlagsState, useLeaveAuth, useSignOut, useLeaveIfSignedIn } from '../../src/components/account/hooks'
import { finishSignIn, setPendingGoogle } from '../../src/components/account/authFlow'
import PhoneVerifyModal from '../../src/components/account/PhoneVerifyModal'
import { Button, Caption, FieldError, PhoneField, Skeleton, Text, TextButton, TextField } from '../../src/ui'

// Same flow as controller-service app/(auth)/login/page.tsx (identifier → OTP, Google, not-found → sign-up),
// laid out the app's way: mobile number first when SMS or WhatsApp is on, email behind one tap.

type Mode = 'phone' | 'email'

export default function LoginScreen() {
  const router = useRouter()
  useLeaveIfSignedIn()
  const { flags, loaded } = useFeatureFlagsState()
  const signOut = useSignOut()

  const phoneChannels = (['sms', 'whatsapp'] as const).filter(c => (c === 'sms' ? flags.smsEnabled : flags.whatsappEnabled))
  const phoneFirst = loaded && phoneChannels.length > 0

  const [mode, setMode] = useState<Mode | null>(null)
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [channel, setChannel] = useState<OtpChannel | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  const [phoneRequiresPolicy, setPhoneRequiresPolicy] = useState(false)

  // Decided once the real flags are in, so the form never flips under the first tap.
  useEffect(() => {
    if (loaded && mode === null) setMode(phoneChannels.length > 0 ? 'phone' : 'email')
  }, [loaded, mode, phoneChannels.length])

  const activeChannel: OtpChannel = channel && phoneChannels.includes(channel as 'sms' | 'whatsapp') ? channel : (phoneChannels[0] ?? 'email')
  const done = useLeaveAuth()

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    try {
      const idToken = await googleSignInIdToken()
      if (!idToken) return
      const result = await googleAuth(idToken)
      if (result.newUser) {
        setPendingGoogle({ idToken, profile: result.profile })
        router.replace({ pathname: '/(auth)/signup', params: { google: '1', from: 'login' } })
        return
      }
      const user = await finishSignIn(result.user, result.token)
      const needsPhone = !user.phone || !user.phoneVerified
      const needsPolicy = !!user.requiresPolicyAcceptance
      if (needsPhone || needsPolicy) {
        setPhoneRequiresPolicy(needsPolicy)
        setShowPhoneModal(true)
      } else done()
    } catch (err: any) {
      setError(err?.message || 'Google sign-in failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  async function handleContinue() {
    setError('')
    const byPhone = mode === 'phone'
    const address = email.trim()
    if (byPhone && phone.length !== 10) return setError('Enter a valid 10-digit mobile number')
    if (!byPhone && !/^\S+@\S+\.\S+$/.test(address)) return setError('Enter a valid email address')
    setIsLoading(true)
    try {
      const res = await requestOtp(
        byPhone
          ? { identifier: phone, phone: `+91${phone}`, channel: activeChannel, isSignup: false }
          : { identifier: address, channel: 'email', isSignup: false }
      )
      const data = res.data
      if (!res.ok) {
        if (res.status === 429 && typeof data.retryAfter === 'number' && !byPhone) {
          router.push({
            pathname: '/(auth)/otp',
            params: { email: address.toLowerCase(), channel: 'email', phone: '', cooldown: String(data.retryAfter), error: data.error || '' },
          })
          return
        }
        if (data.userNotFound) {
          router.replace({ pathname: '/(auth)/signup', params: byPhone ? { from: 'login', phone } : { email: address, from: 'login' } })
          return
        }
        throw new Error(data.error || 'Failed to send OTP')
      }
      router.push({
        pathname: '/(auth)/otp',
        params: {
          email: data.resolvedEmail || address,
          channel: byPhone ? activeChannel : 'email',
          phone: byPhone ? phone : '',
          requiresPolicy: data.requiresPolicyAcceptance ? '1' : '0',
          cooldown: String(typeof data.nextCooldown === 'number' ? data.nextCooldown : 30),
        },
      })
    } catch (err: any) {
      setError(err?.message || 'Failed to send OTP')
    } finally {
      setIsLoading(false)
    }
  }

  const subtitle =
    mode === 'phone' ? 'Enter your mobile number and we’ll send you a code.' : 'Enter your email and we’ll send you a code.'

  return (
    <AuthScreen title="Login or sign up" subtitle={mode ? subtitle : undefined}>
      {mode === null ? (
        <View className="gap-4">
          <Skeleton height={56} rounded="rounded-2xl" />
          <Skeleton height={56} rounded="rounded-2xl" />
        </View>
      ) : (
        <View className="gap-4">
          {mode === 'phone' ? (
            <View>
              <PhoneField
                value={phone}
                onChange={setPhone}
                accessibilityLabel="Mobile number"
                placeholder="Mobile number"
                keyboardType="number-pad"
                autoFocus
                clearable
                returnKeyType="done"
                onSubmitEditing={handleContinue}
              />
              {phoneChannels.length > 1 ? (
                <ChannelChips label="Get the code on" options={phoneChannels} value={activeChannel} onChange={setChannel} />
              ) : (
                <Caption className="mt-2">We’ll send the code on {activeChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'}.</Caption>
              )}
            </View>
          ) : (
            <TextField
              value={email}
              onChangeText={setEmail}
              accessibilityLabel="Email address"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              autoComplete="email"
              textContentType="emailAddress"
              placeholder="Email address"
              returnKeyType="done"
              onSubmitEditing={handleContinue}
            />
          )}

          <FieldError message={error} />
          <Button label="Continue" loadingLabel="Sending code…" loading={isLoading} onPress={handleContinue} />

          {phoneFirst ? (
            <TextButton
              label={mode === 'phone' ? 'Use email instead' : 'Use mobile number instead'}
              onPress={() => {
                setError('')
                setMode(mode === 'phone' ? 'email' : 'phone')
              }}
            />
          ) : null}

          {!!GOOGLE_WEB_CLIENT_ID && <GoogleRow label="Continue with Google" loading={googleLoading} onPress={handleGoogle} />}
          <Text className="text-center text-sm text-foreground-secondary">
            Buying for a business?{' '}
            <Text accessibilityRole="link" className="font-semibold text-accent-600 dark:text-accent-400" onPress={() => router.replace('/(auth)/business-login')}>
              Business sign in
            </Text>
          </Text>
          <TermsNote />
        </View>
      )}

      {showPhoneModal && (
        <PhoneVerifyModal
          requiresPolicy={phoneRequiresPolicy}
          title={phoneRequiresPolicy ? 'Almost there' : undefined}
          onVerified={() => {
            setShowPhoneModal(false)
            done()
          }}
          onCancel={() => {
            setShowPhoneModal(false)
            signOut()
          }}
        />
      )}
    </AuthScreen>
  )
}
