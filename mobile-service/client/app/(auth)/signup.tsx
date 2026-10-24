import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Text, TextInput, View, type TextInputProps } from 'react-native'
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
import { AuthScreen, BigButton, FieldError, Frame, GoogleRow, Note, TermsNote, TextAction } from '../../src/components/account/AuthScreen'
import { ChannelChips } from '../../src/components/account/ChannelChips'
import { OtpBoxes } from '../../src/components/account/OtpBoxes'
import { isValidDob, PolicyConsent, useDobField } from '../../src/components/account/ui'
import { useFeatureFlags, useLeaveAuth, useSignOut, useLeaveIfSignedIn } from '../../src/components/account/hooks'
import { finishSignIn, getPendingGoogle, setPendingGoogle } from '../../src/components/account/authFlow'
import PhoneVerifyModal from '../../src/components/account/PhoneVerifyModal'
import { useTokens } from '../../src/theme'

// Same flow as controller-service app/(auth)/signup/page.tsx (details → OTP → account; Google completes
// with phone + DOB), in the app's sheet.

function Field({ label, children, error, className = '' }: { label: string; children: ReactNode; error?: string; className?: string }) {
  return (
    <View className={className}>
      <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-foreground-muted">{label}</Text>
      {children}
      {error ? <FieldError message={error} /> : null}
    </View>
  )
}

function TextField({ prefix, locked, ...props }: TextInputProps & { prefix?: string; locked?: boolean }) {
  const t = useTokens()
  const [focus, setFocus] = useState(false)
  return (
    <Frame focused={focus} className={locked ? 'bg-surface-secondary' : ''}>
      {prefix ? (
        <>
          <Text className="text-base font-semibold text-foreground">{prefix}</Text>
          <View className="mx-3 h-6 w-px bg-border-secondary" />
        </>
      ) : null}
      <TextInput
        placeholderTextColor={t.foregroundMuted}
        editable={!locked}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        className={`flex-1 text-base font-semibold ${locked ? 'text-foreground-muted' : 'text-foreground'}`}
        {...props}
      />
    </Frame>
  )
}

function DobField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { text, handle } = useDobField(value, onChange)
  return <TextField value={text} onChangeText={handle} keyboardType="number-pad" maxLength={10} placeholder="dd/mm/yyyy" />
}

export default function SignupScreen() {
  const router = useRouter()
  useLeaveIfSignedIn()
  const params = useLocalSearchParams<{ email?: string; phone?: string; from?: string; google?: string }>()
  const fromLogin = params.from === 'login'
  const prefillEmail = params.email || ''
  const isGoogleMode = params.google === '1'
  const config = useStoreConfig()
  const storeName = config.identity.name || 'Jeffi Stores'
  const flags = useFeatureFlags()
  const signOut = useSignOut()
  const { data: invitedBy } = useQuery({ queryKey: ['referral-lookup'], queryFn: referralLookup, staleTime: 60_000 })

  const channels = (['email', 'sms', 'whatsapp'] as const).filter(
    c => c === 'email' || (c === 'sms' && flags.smsEnabled) || (c === 'whatsapp' && flags.whatsappEnabled)
  )

  const [step, setStep] = useState<'details' | 'otp'>('details')
  const [email, setEmail] = useState(prefillEmail)
  const [otp, setOtp] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState((params.phone || '').replace(/\D/g, '').slice(-10))
  const [dob, setDob] = useState('')
  const [channel, setChannel] = useState<OtpChannel>('email')
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [error, setError] = useState('')
  const [shake, setShake] = useState(0)
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

  const done = useLeaveAuth()

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
      throw new Error(res.data.error || (isResend ? 'Failed to resend the code' : 'Failed to send the code'))
    }
    return res.data
  }

  async function handleSendOTP() {
    setError('')
    if (!firstName.trim()) return setError('First name is required')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address')
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
      if (!verify.ok) throw new Error(verify.data.error || 'Invalid code')
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
      setShake(n => n + 1)
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
      showToast('New code sent', 'success')
      setTimeout(() => otpInputRef.current?.focus(), 0)
    } catch (err: any) {
      setError(err?.message || 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const otpDestination = channel === 'email' ? email : `+91 ••••• ${phone.slice(-4)} on ${channel === 'sms' ? 'SMS' : 'WhatsApp'}`
  const title = step === 'otp' ? 'Enter the code' : googleMode ? 'Almost there' : 'Create your account'
  const subtitle =
    step === 'otp'
      ? `We sent a 6-digit code to ${otpDestination}.`
      : googleMode
        ? 'Add a mobile number and date of birth to finish signing up.'
        : `Join ${storeName} for faster checkout, order tracking and member deals.`

  return (
    <AuthScreen title={title} subtitle={subtitle}>
      {step === 'details' && !!invitedBy && <Note>{invitedBy} invited you to {storeName}.</Note>}
      {step === 'details' && googleMode && (
        <Note>
          No account found for <Text className="font-bold">{email}</Text>. Confirm your details to continue.
        </Note>
      )}
      {step === 'details' && !googleMode && fromLogin && (!!prefillEmail || phone.length === 10) && (
        <Note>
          No account found for <Text className="font-bold">{prefillEmail || `+91 ${phone}`}</Text>. Create one to continue.
        </Note>
      )}

      {step === 'details' && (
        <View className="gap-4">
          <View className="flex-row gap-3">
            <Field label="First name" className="flex-1">
              <TextField value={firstName} onChangeText={setFirstName} placeholder="First" autoCapitalize="words" autoComplete="given-name" autoFocus={!googleMode} />
            </Field>
            <Field label="Last name" className="flex-1">
              <TextField value={lastName} onChangeText={setLastName} placeholder="Last" autoCapitalize="words" autoComplete="family-name" />
            </Field>
          </View>
          <Field label="Email">
            <TextField
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              locked={googleMode}
            />
          </Field>
          <Field label={googleMode ? 'Mobile number' : 'Mobile number (optional)'} error={phone.length > 0 && phone.length !== 10 ? 'Enter a valid 10-digit mobile number' : ''}>
            <TextField
              prefix="+91"
              value={phone}
              onChangeText={v => setPhone(v.replace(/\D/g, '').slice(0, 10))}
              placeholder="Mobile number"
              keyboardType="number-pad"
              maxLength={10}
              autoComplete="tel"
              textContentType="telephoneNumber"
            />
          </Field>
          <Field label="Date of birth" error={dob.length > 0 && !isValidDob(dob) ? 'Enter a valid date of birth' : ''}>
            <DobField value={dob} onChange={setDob} />
          </Field>

          {!googleMode && channels.length > 1 ? (
            <ChannelChips
              label="Send my code on"
              options={channels}
              value={channel}
              onChange={setChannel}
              isDisabled={c => (c === 'sms' || c === 'whatsapp') && phone.length !== 10}
            />
          ) : null}
          {googleMode ? <PolicyConsent checked={policyAccepted} onChange={setPolicyAccepted} /> : null}

          <FieldError message={error} />
          {googleMode ? (
            <BigButton
              label="Continue"
              loadingLabel="Creating account…"
              loading={isLoading}
              disabled={phone.length !== 10 || !isValidDob(dob) || !policyAccepted}
              onPress={handleGoogleSubmit}
            />
          ) : (
            <BigButton label="Send code" loadingLabel="Sending code…" loading={isLoading} onPress={handleSendOTP} />
          )}

          {!googleMode && !!GOOGLE_WEB_CLIENT_ID && <GoogleRow label="Sign up with Google" loading={googleLoading} onPress={handleGoogle} />}
          <TermsNote />
        </View>
      )}

      {step === 'otp' && (
        <View className="gap-5">
          <View>
            <OtpBoxes value={otp} onChange={setOtp} inputRef={otpInputRef} shake={shake} />
            <FieldError message={error} />
          </View>
          <View className="flex-row items-center justify-between">
            <TextAction
              label={resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
              muted={resendCooldown > 0 || isLoading}
              onPress={() => {
                if (!isLoading && resendCooldown <= 0) handleResendOTP()
              }}
            />
            <TextAction
              label="Change details"
              muted
              onPress={() => {
                setStep('details')
                setOtp('')
                setError('')
                submittedOtpRef.current = ''
              }}
            />
          </View>
          <PolicyConsent checked={policyAccepted} onChange={setPolicyAccepted} />
          <BigButton
            label="Create account"
            loadingLabel="Creating account…"
            loading={isLoading}
            disabled={otp.length !== 6 || !policyAccepted}
            onPress={() => otp.length === 6 && submitVerifyAndSignup(otp)}
          />
        </View>
      )}

      <Text className="mt-6 text-center text-sm text-foreground-secondary">
        Already have an account?{' '}
        <Text className="font-semibold text-accent-600 dark:text-accent-400" onPress={() => router.replace('/(auth)/login')}>
          Log in
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
    </AuthScreen>
  )
}
