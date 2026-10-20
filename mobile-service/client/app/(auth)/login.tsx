import { useState } from 'react'
import { Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { googleAuth, googleSignInIdToken, GOOGLE_WEB_CLIENT_ID, requestOtp, type OtpChannel } from '../../src/api/auth'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { AuthShell, ChannelSelector, CHANNELS, GoogleButton } from '../../src/components/account/AuthShell'
import { ErrorBox, Input, Label, PhoneInput, PrimaryButton } from '../../src/components/account/ui'
import { useFeatureFlags, useSignOut, useLeaveIfSignedIn } from '../../src/components/account/hooks'
import { finishSignIn, setPendingGoogle } from '../../src/components/account/authFlow'
import PhoneVerifyModal from '../../src/components/account/PhoneVerifyModal'

// Mirror of controller-service app/(auth)/login/page.tsx (the email step; the code step is otp.tsx).

export default function LoginScreen() {
  const router = useRouter()
  useLeaveIfSignedIn()
  const config = useStoreConfig()
  const flags = useFeatureFlags()
  const signOut = useSignOut()

  const [identifier, setIdentifier] = useState('')
  const [loginPhone, setLoginPhone] = useState('')
  const [selectedChannel, setSelectedChannel] = useState<OtpChannel>('email')
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPhoneModal, setShowPhoneModal] = useState(false)
  const [phoneRequiresPolicy, setPhoneRequiresPolicy] = useState(false)

  const channelOptions = CHANNELS.filter(
    o => o.id === 'email' || (o.id === 'sms' && flags.smsEnabled) || (o.id === 'whatsapp' && flags.whatsappEnabled)
  )
  const identifierIsPhone = /^\d/.test(identifier.trim())

  const done = () => router.dismissAll()

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

  async function handleSendOTP() {
    setError('')
    const idTrimmed = identifier.trim()
    if (!idTrimmed) return setError('Enter your email or mobile number')
    // Identifying by phone, that number receives the OTP; otherwise SMS/WhatsApp needs a separate number.
    const deliveryPhone = identifierIsPhone ? idTrimmed.replace(/\D/g, '') : loginPhone
    if (identifierIsPhone && deliveryPhone.length !== 10) return setError('Enter a valid 10-digit mobile number')
    if (!identifierIsPhone && selectedChannel !== 'email' && loginPhone.length !== 10) return setError('Enter a valid 10-digit mobile number')
    setIsLoading(true)
    try {
      const res = await requestOtp({
        identifier: idTrimmed,
        phone: deliveryPhone.length === 10 ? `+91${deliveryPhone}` : undefined,
        channel: selectedChannel,
        isSignup: false,
      })
      const data = res.data
      if (!res.ok) {
        if (res.status === 429 && typeof data.retryAfter === 'number' && !identifierIsPhone) {
          router.push({
            pathname: '/(auth)/otp',
            params: { email: idTrimmed.toLowerCase(), channel: selectedChannel, phone: deliveryPhone, cooldown: String(data.retryAfter), error: data.error || '' },
          })
          return
        }
        if (data.userNotFound) {
          router.replace({
            pathname: '/(auth)/signup',
            params: identifierIsPhone ? { from: 'login' } : { email: idTrimmed, from: 'login' },
          })
          return
        }
        throw new Error(data.error || 'Failed to send OTP')
      }
      router.push({
        pathname: '/(auth)/otp',
        params: {
          email: data.resolvedEmail || idTrimmed,
          channel: selectedChannel,
          phone: deliveryPhone,
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

  return (
    <AuthShell title="Welcome Back" subtitle={`Login to your ${config.identity.name || 'Jeffi Stores'} account`}>
      <ErrorBox message={error} />

      {!!GOOGLE_WEB_CLIENT_ID && (
        <GoogleButton
          label="Continue with Google"
          loadingLabel="Signing in…"
          loading={googleLoading}
          onPress={handleGoogle}
          dividerText="or continue with email or mobile"
        />
      )}

      <View className="gap-5">
        <View>
          <Label>Email or Mobile Number</Label>
          <Input
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="username"
            placeholder="your@email.com or 10-digit number"
            returnKeyType="send"
            onSubmitEditing={handleSendOTP}
          />
        </View>

        <View>
          <Text className="text-sm font-medium text-foreground-secondary mb-2">Send OTP via</Text>
          <ChannelSelector options={channelOptions} value={selectedChannel} onChange={setSelectedChannel} />
        </View>

        {!identifierIsPhone && (selectedChannel === 'sms' || selectedChannel === 'whatsapp') && (
          <View>
            <Label>Mobile Number</Label>
            <PhoneInput value={loginPhone} onChange={setLoginPhone} autoFocus />
            {loginPhone.length > 0 && loginPhone.length !== 10 && (
              <Text className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</Text>
            )}
          </View>
        )}

        <PrimaryButton label="Continue" loadingLabel="Sending OTP..." loading={isLoading} onPress={handleSendOTP} />
      </View>

      <Text className="mt-6 text-center text-sm text-foreground-secondary">
        Don&apos;t have an account?{' '}
        <Text className="text-accent-600 dark:text-accent-400 font-medium" onPress={() => router.replace('/(auth)/signup')}>
          Create one
        </Text>
      </Text>

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
    </AuthShell>
  )
}
