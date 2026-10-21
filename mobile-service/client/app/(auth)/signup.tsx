import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import {
  googleAuth,
  googleComplete,
  googleSignInIdToken,
  GOOGLE_WEB_CLIENT_ID,
  requestOtp,
  signup,
  verifyEmailOtp,
  type OtpChannel,
} from '../../src/api/auth'
import { referralLookup } from '../../src/api/account'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { showToast } from '../../src/stores/toastStore'
import { AuthShell, ChannelSelector, CHANNELS, GoogleButton, OtpField, SentNote } from '../../src/components/account/AuthShell'
import { DobInput, ErrorBox, Input, isValidDob, Label, PhoneInput, PolicyConsent, PrimaryButton } from '../../src/components/account/ui'
import { useFeatureFlags, useSignOut, useLeaveIfSignedIn } from '../../src/components/account/hooks'
import { finishSignIn, getPendingGoogle, setPendingGoogle } from '../../src/components/account/authFlow'
import PhoneVerifyModal from '../../src/components/account/PhoneVerifyModal'

// Mirror of controller-service app/(auth)/signup/page.tsx.

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View>
      <Label>{label}</Label>
      {children}
    </View>
  )
}

export default function SignupScreen() {
  const router = useRouter()
  useLeaveIfSignedIn()
  const params = useLocalSearchParams<{ email?: string; from?: string; google?: string }>()
  const fromLogin = params.from === 'login'
  const prefillEmail = params.email || ''
  const isGoogleMode = params.google === '1'
  const config = useStoreConfig()
  const storeName = config.identity.name || 'Jeffi Stores'
  const flags = useFeatureFlags()
  const signOut = useSignOut()
  const { data: invitedBy } = useQuery({ queryKey: ['referral-lookup'], queryFn: referralLookup, staleTime: 60_000 })

  const channelOptions = CHANNELS.filter(
    o => o.id === 'email' || (o.id === 'sms' && flags.smsEnabled) || (o.id === 'whatsapp' && flags.whatsappEnabled)
  )

  const [step, setStep] = useState<'details' | 'otp'>('details')
  const [email, setEmail] = useState(prefillEmail)
  const [otp, setOtp] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [channel, setChannel] = useState<OtpChannel>('email')
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState('')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [phoneRequiresPolicy, setPhoneRequiresPolicy] = useState(false)
  const [phoneRequiresDob, setPhoneRequiresDob] = useState(false)
  const [showPhoneVerify, setShowPhoneVerify] = useState(false)
  const [googleMode, setGoogleMode] = useState(false)
  const [googleIdToken, setGoogleIdToken] = useState('')
  const otpInputRef = useRef<TextInput>(null)
  const submittedOtpRef = useRef('')

  useEffect(() => {
    if (!isGoogleMode) return
    const pending = getPendingGoogle()
    if (!pending) {
      setError('Google sign-up session expired. Please try again.')
      return
    }
    setGoogleIdToken(pending.idToken)
    setEmail(pending.profile.email || '')
    setFirstName(pending.profile.firstName || '')
    setLastName(pending.profile.lastName || '')
    setGoogleMode(true)
  }, [isGoogleMode])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [resendCooldown])

  // Back to email when the phone needed for SMS/WhatsApp is cleared.
  useEffect(() => {
    if (phone.length === 0 && (channel === 'sms' || channel === 'whatsapp')) setChannel('email')
  }, [phone, channel])

  const done = () => router.dismissAll()

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    try {
      const idToken = await googleSignInIdToken()
      if (!idToken) return
      const result = await googleAuth(idToken)
      if (result.newUser) {
        setGoogleIdToken(idToken)
        setEmail(result.profile.email || '')
        setFirstName(result.profile.firstName || '')
        setLastName(result.profile.lastName || '')
        setGoogleMode(true)
        setStep('details')
        return
      }
      const user = await finishSignIn(result.user, result.token)
      const needsPhone = !user.phone || !user.phoneVerified
      const needsPolicy = !!user.requiresPolicyAcceptance
      const needsDob = !user.dateOfBirth
      if (needsPhone || needsPolicy || needsDob) {
        setPhoneRequiresPolicy(needsPolicy)
        setPhoneRequiresDob(needsDob)
        setPolicyAccepted(false)
        setShowPhoneVerify(true)
      } else done()
    } catch (err: any) {
      setError(err?.message || 'An error occurred')
    } finally {
      setGoogleLoading(false)
    }
  }

  async function handleGoogleSubmit() {
    setError('')
    if (!firstName.trim()) return setError('First name is required')
    if (phone.length !== 10) return setError('Enter a valid 10-digit mobile number')
    if (!isValidDob(dob)) return setError('Enter a valid date of birth')
    if (!policyAccepted) return setError('Please accept the Privacy Policy and Terms & Conditions')
    setIsLoading(true)
    try {
      const result = await googleComplete({
        idToken: googleIdToken,
        firstName,
        lastName: lastName || undefined,
        phone: `+91${phone}`,
        dateOfBirth: dob,
      })
      setPendingGoogle(null)
      await finishSignIn(result.user, result.token)
      setPhoneRequiresPolicy(false)
      setPhoneRequiresDob(false)
      setShowPhoneVerify(true)
    } catch (err: any) {
      setError(err?.message || 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  async function sendCode(isResend: boolean) {
    const res = await requestOtp({ email, isSignup: true, channel, ...(phone.length === 10 ? { phone: `+91${phone}` } : {}) })
    if (!res.ok) {
      if (res.status === 429 && typeof res.data.retryAfter === 'number') {
        setResendCooldown(res.data.retryAfter)
        if (!isResend) setStep('otp')
      }
      throw new Error(res.data.error || (isResend ? 'Failed to resend OTP' : 'Failed to send OTP'))
    }
    return res.data
  }

  async function handleSendOTP() {
    setError('')
    if (!firstName.trim()) return setError('First name is required')
    if (phone.length > 0 && phone.length !== 10) return setError('Enter a valid 10-digit mobile number')
    if (!isValidDob(dob)) return setError('Enter a valid date of birth')
    setIsLoading(true)
    try {
      const data = await sendCode(false)
      setStep('otp')
      setResendCooldown(typeof data.nextCooldown === 'number' ? data.nextCooldown : 30)
    } catch (err: any) {
      setError(err?.message || 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const submitVerifyAndSignup = async (otpValue: string) => {
    if (submittedOtpRef.current === otpValue) return
    if (!policyAccepted) return
    submittedOtpRef.current = otpValue
    setError('')
    setIsLoading(true)
    try {
      const verify = await verifyEmailOtp(email, otpValue)
      if (!verify.ok) throw new Error(verify.data.error || 'Invalid OTP')
      const result = await signup({
        email,
        otp: otpValue,
        firstName,
        lastName: lastName || undefined,
        phone: phone.length === 10 ? `+91${phone}` : undefined,
        dateOfBirth: dob,
      })
      await finishSignIn(result.user, result.token)
      done()
    } catch (err: any) {
      setError(err?.message || 'An error occurred')
      setOtp('')
      submittedOtpRef.current = ''
      setTimeout(() => otpInputRef.current?.focus(), 0)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (step !== 'otp' || otp.length !== 6 || isLoading || !policyAccepted) return
    submitVerifyAndSignup(otp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step, isLoading, policyAccepted])

  const handleResendOTP = async () => {
    setError('')
    setOtp('')
    submittedOtpRef.current = ''
    setIsLoading(true)
    try {
      const data = await sendCode(true)
      setResendCooldown(typeof data.nextCooldown === 'number' ? data.nextCooldown : 60)
      showToast('OTP sent successfully!', 'success')
      setTimeout(() => otpInputRef.current?.focus(), 0)
    } catch (err: any) {
      setError(err?.message || 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const otpDestination = channel === 'email' ? email : `+91 ••••• ${phone.slice(-4)}`

  return (
    <AuthShell title="Create Account" subtitle={`Join ${storeName} for exclusive deals`}>
      {!!invitedBy && (
        <View className="mb-6 rounded-lg border border-accent-200 dark:border-accent-800 bg-accent-50 dark:bg-accent-900/20 p-3">
          <Text className="text-center text-sm text-accent-700 dark:text-accent-300">
            {invitedBy} invited you to {storeName}.
          </Text>
        </View>
      )}

      {googleMode && step === 'details' && (
        <SentNote>
          No account found for <Text className="font-bold">{email}</Text>. Confirm your details and add a mobile number and date of
          birth to finish signing up.
        </SentNote>
      )}
      {fromLogin && !googleMode && step === 'details' && !!prefillEmail && (
        <SentNote>
          No account found for <Text className="font-bold">{prefillEmail}</Text>. Create one to continue.
        </SentNote>
      )}

      <ErrorBox message={error} />

      {step === 'details' && !googleMode && !!GOOGLE_WEB_CLIENT_ID && (
        <GoogleButton
          label="Sign up with Google"
          loadingLabel="Signing up…"
          loading={googleLoading}
          onPress={handleGoogle}
          dividerText="or sign up with email"
        />
      )}

      {step === 'details' && !googleMode && (
        <View className="gap-5">
          <View className="gap-4">
            <Field label="First Name *">
              <Input value={firstName} onChangeText={setFirstName} placeholder="John" autoCapitalize="words" autoFocus />
            </Field>
            <Field label="Last Name">
              <Input value={lastName} onChangeText={setLastName} placeholder="Doe" autoCapitalize="words" />
            </Field>
          </View>
          <Field label="Email Address *">
            <Input value={email} onChangeText={setEmail} placeholder="your@email.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
          </Field>
          <Field label="Mobile Number *">
            <PhoneInput value={phone} onChange={setPhone} />
            {phone.length > 0 && phone.length !== 10 && <Text className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</Text>}
          </Field>
          <Field label="Date of Birth *">
            <DobInput value={dob} onChange={setDob} />
            {dob.length > 0 && !isValidDob(dob) && <Text className="mt-1 text-xs text-red-500">Enter a valid date of birth</Text>}
          </Field>
          <View>
            <Text className="text-sm font-medium text-foreground-secondary mb-2">How would you like to receive your OTP?</Text>
            <ChannelSelector
              options={channelOptions}
              value={channel}
              onChange={setChannel}
              isDisabled={c => (c === 'sms' || c === 'whatsapp') && phone.length !== 10}
            />
          </View>
          <PrimaryButton label="Send Verification Code" loadingLabel="Sending OTP..." loading={isLoading} onPress={handleSendOTP} />
        </View>
      )}

      {step === 'details' && googleMode && (
        <View className="gap-5">
          <View className="gap-4">
            <Field label="First Name *">
              <Input value={firstName} onChangeText={setFirstName} placeholder="John" autoCapitalize="words" />
            </Field>
            <Field label="Last Name">
              <Input value={lastName} onChangeText={setLastName} placeholder="Doe" autoCapitalize="words" />
            </Field>
          </View>
          <Field label="Email Address">
            <Input value={email} editable={false} muted />
          </Field>
          <Field label="Mobile Number *">
            <PhoneInput value={phone} onChange={setPhone} />
            {phone.length > 0 && phone.length !== 10 && <Text className="mt-1 text-xs text-red-500">Enter a valid 10-digit mobile number</Text>}
          </Field>
          <Field label="Date of Birth *">
            <DobInput value={dob} onChange={setDob} />
            {dob.length > 0 && !isValidDob(dob) && <Text className="mt-1 text-xs text-red-500">Enter a valid date of birth</Text>}
          </Field>
          <PolicyConsent checked={policyAccepted} onChange={setPolicyAccepted} />
          <PrimaryButton
            label="Continue"
            loadingLabel="Creating Account..."
            loading={isLoading}
            disabled={phone.length !== 10 || !isValidDob(dob) || !policyAccepted}
            onPress={handleGoogleSubmit}
          />
        </View>
      )}

      {step === 'otp' && (
        <View className="gap-6">
          <SentNote>
            We&apos;ve sent a 6-digit verification code to <Text className="font-bold">{otpDestination}</Text>
          </SentNote>
          <View>
            <Label>Verification Code</Label>
            <OtpField value={otp} onChange={setOtp} inputRef={otpInputRef} />
          </View>
          <View className="flex-row items-center justify-between">
            <Pressable onPress={handleResendOTP} disabled={isLoading || resendCooldown > 0}>
              <Text className={`text-sm font-medium text-accent-600 dark:text-accent-400 ${isLoading || resendCooldown > 0 ? 'opacity-50' : ''}`}>
                {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend Code'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setStep('details')
                setOtp('')
                submittedOtpRef.current = ''
              }}
            >
              <Text className="text-sm text-foreground-secondary">Change details</Text>
            </Pressable>
          </View>
          <PolicyConsent checked={policyAccepted} onChange={setPolicyAccepted} />
          <PrimaryButton
            label="Verify & Create Account"
            loadingLabel="Creating Account..."
            loading={isLoading}
            disabled={otp.length !== 6 || !policyAccepted}
            onPress={() => otp.length === 6 && submitVerifyAndSignup(otp)}
          />
        </View>
      )}

      <Text className="mt-6 text-center text-sm text-foreground-secondary">
        Already have an account?{' '}
        <Text className="text-accent-600 dark:text-accent-400 font-medium" onPress={() => router.replace('/(auth)/login')}>
          Login here
        </Text>
      </Text>

      {showPhoneVerify && (
        <PhoneVerifyModal
          requiresPolicy={phoneRequiresPolicy}
          requiresDob={phoneRequiresDob}
          initialPhone={googleMode ? phone : ''}
          abandonOnCancel={googleMode}
          title={googleMode ? 'Verify your mobile number' : phoneRequiresPolicy || phoneRequiresDob ? 'Almost there' : undefined}
          onVerified={() => {
            setShowPhoneVerify(false)
            done()
          }}
          onCancel={() => {
            setShowPhoneVerify(false)
            signOut()
          }}
        />
      )}
    </AuthShell>
  )
}
