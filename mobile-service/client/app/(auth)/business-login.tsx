import { useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { googleSignInIdToken, GOOGLE_WEB_CLIENT_ID, requestOtp, type OtpChannel } from '../../src/api/auth'
import { businessGoogle } from '../../src/api/business'
import { AuthScreen, GoogleRow, TermsNote } from '../../src/components/account/AuthScreen'
import { ChannelChips } from '../../src/components/account/ChannelChips'
import { useFeatureFlags, useLeaveAuth, useLeaveIfSignedIn, useSignOut } from '../../src/components/account/hooks'
import { finishSignIn, setPendingGoogle } from '../../src/components/account/authFlow'
import PhoneVerifyModal from '../../src/components/account/PhoneVerifyModal'
import { Button, FieldError, Notice, PhoneField, Text, TextField } from '../../src/ui'

// Same flow as controller-service app/(business)/business/signin/page.tsx: email (+ phone for SMS/WhatsApp) → OTP
// on the shared code screen; Google; an unknown email goes to the business application.

export default function BusinessLoginScreen() {
  const router = useRouter()
  useLeaveIfSignedIn()
  const params = useLocalSearchParams<{ email?: string; notice?: string }>()
  const flags = useFeatureFlags()
  const signOut = useSignOut()
  const done = useLeaveAuth()

  const channels = (['email', 'sms', 'whatsapp'] as const).filter(
    c => c === 'email' || (c === 'sms' && flags.smsEnabled) || (c === 'whatsapp' && flags.whatsappEnabled)
  )

  const [email, setEmail] = useState(params.email || '')
  const [phone, setPhone] = useState('')
  const [channel, setChannel] = useState<OtpChannel>('email')
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [phoneModal, setPhoneModal] = useState<{ requiresPolicy: boolean } | null>(null)

  async function handleContinue() {
    setError('')
    const address = email.trim()
    if (!/^\S+@\S+\.\S+$/.test(address)) return setError('Enter a valid email address')
    if (channel !== 'email' && phone.length !== 10) return setError('Enter a valid 10-digit mobile number')
    setIsLoading(true)
    try {
      const res = await requestOtp({
        email: address,
        ...(channel !== 'email' ? { phone: `+91${phone}` } : {}),
        channel,
        isSignup: false,
        userType: 'business',
      })
      const data = res.data
      if (!res.ok) {
        if (res.status === 429 && typeof data.retryAfter === 'number') {
          router.push({
            pathname: '/(auth)/otp',
            params: { email: address.toLowerCase(), channel, phone, portal: 'business', cooldown: String(data.retryAfter), error: data.error || '' },
          })
          return
        }
        if (data.userNotFound) {
          router.replace({ pathname: '/(auth)/business-signup', params: { email: address } })
          return
        }
        throw new Error(data.error || 'Failed to send OTP')
      }
      router.push({
        pathname: '/(auth)/otp',
        params: {
          email: address,
          channel,
          phone: channel !== 'email' ? phone : '',
          portal: 'business',
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

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    try {
      const idToken = await googleSignInIdToken()
      if (!idToken) return
      const res = await businessGoogle(idToken)
      const data = res.data
      if (!res.ok) throw new Error(data.error || 'Google sign-in failed')
      if (data.newUser && data.profile) {
        setPendingGoogle({ idToken, profile: data.profile })
        router.replace({ pathname: '/(auth)/business-signup', params: { google: '1' } })
        return
      }
      if (data.approvalStatus !== 'approved' || !data.user || !data.token) {
        router.replace({ pathname: '/business/pending', params: { status: data.approvalStatus || 'pending' } })
        return
      }
      const user = await finishSignIn(data.user, data.token, 'business')
      const needsPolicy = !!user.requiresPolicyAcceptance
      if (!user.phone || needsPolicy) setPhoneModal({ requiresPolicy: needsPolicy })
      else done()
    } catch (err: any) {
      setError(err?.message || 'Google sign-in failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  return (
    <AuthScreen title="Business sign in" subtitle="Sign in to your business account for trade prices, quotes and GST invoices.">
      {params.notice === 'already_registered' && (
        <Notice className="mb-4">This email already has a business account. Sign in to continue.</Notice>
      )}
      <View className="gap-4">
        <TextField
          label="Business email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          placeholder="you@company.com"
          autoFocus={!params.email}
          returnKeyType="done"
          onSubmitEditing={handleContinue}
        />
        {channels.length > 1 && <ChannelChips label="Get the code on" options={channels} value={channel} onChange={setChannel} />}
        {channel !== 'email' && (
          <PhoneField
            label="Registered mobile number"
            value={phone}
            onChange={setPhone}
            placeholder="Mobile number"
            keyboardType="number-pad"
            returnKeyType="done"
            onSubmitEditing={handleContinue}
          />
        )}

        <FieldError message={error} />
        <Button label="Continue" loadingLabel="Sending code…" loading={isLoading} onPress={handleContinue} />

        {!!GOOGLE_WEB_CLIENT_ID && <GoogleRow label="Continue with Google" loading={googleLoading} onPress={handleGoogle} />}

        <Text className="text-center text-sm text-foreground-secondary">
          New business?{' '}
          <Text
            accessibilityRole="link"
            className="font-semibold text-accent-600 dark:text-accent-400"
            onPress={() => router.replace({ pathname: '/(auth)/business-signup', params: email.trim() ? { email: email.trim() } : {} })}
          >
            Apply for an account
          </Text>
        </Text>
        <Text className="text-center text-sm text-foreground-secondary">
          Shopping for yourself?{' '}
          <Text accessibilityRole="link" className="font-semibold text-accent-600 dark:text-accent-400" onPress={() => router.replace('/(auth)/login')}>
            Customer sign in
          </Text>
        </Text>
        <TermsNote />
      </View>

      {phoneModal && (
        <PhoneVerifyModal
          requiresPolicy={phoneModal.requiresPolicy}
          title={phoneModal.requiresPolicy ? 'Almost there' : undefined}
          onVerified={() => {
            setPhoneModal(null)
            done()
          }}
          onCancel={() => {
            setPhoneModal(null)
            signOut()
          }}
        />
      )}
    </AuthScreen>
  )
}
