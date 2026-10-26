import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { googleSignInIdToken, GOOGLE_WEB_CLIENT_ID, requestOtp, verifyEmailOtp } from '../../src/api/auth'
import { lookupPincode } from '../../src/api/addresses'
import { businessGoogle, businessGoogleComplete, businessSignup, type BusinessDetails } from '../../src/api/business'
import { useStoreConfig } from '../../src/hooks/useStoreConfig'
import { showToast } from '../../src/stores/toastStore'
import { useAuthStore } from '../../src/stores/authStore'
import { AuthScreen, GoogleRow, TermsNote } from '../../src/components/account/AuthScreen'
import { DobInput, isValidDob, PolicyConsent } from '../../src/components/account/ui'
import { useLeaveIfSignedIn } from '../../src/components/account/hooks'
import { finishSignIn, getPendingGoogle, setPendingGoogle } from '../../src/components/account/authFlow'
import PhoneVerifyModal from '../../src/components/account/PhoneVerifyModal'
import { Button, FieldError, Notice, OtpField, PhoneField, SelectField, Text, TextButton, TextField, type FieldRef } from '../../src/ui'

// Same flow as controller-service app/(business)/business/signup/page.tsx: email → OTP → business details
// (Google skips to the details). The account starts pending; an admin approves it.

const INDUSTRIES = [
  'Manufacturing',
  'Construction',
  'Solar & Renewable Energy',
  'Electronics & Electrical',
  'Retail & Distribution',
  'Engineering & Fabrication',
  'Agriculture',
  'Education',
  'Government',
  'Healthcare',
  'IT & Technology',
  'Other',
].map(v => ({ value: v, label: v }))

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

type Step = 'email' | 'otp' | 'details'

export default function BusinessSignupScreen() {
  const router = useRouter()
  useLeaveIfSignedIn()
  const params = useLocalSearchParams<{ email?: string; google?: string }>()
  const storeName = useStoreConfig().identity.name || 'Jeffi Stores'

  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState(params.email || '')
  const [otp, setOtp] = useState('')
  const [policyAccepted, setPolicyAccepted] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [shake, setShake] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [googleIdToken, setGoogleIdToken] = useState('')
  const [showPhoneVerify, setShowPhoneVerify] = useState(false)
  const otpRef = useRef<FieldRef>(null)
  const submittedOtp = useRef('')

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [dob, setDob] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [industry, setIndustry] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [landmark, setLandmark] = useState('')
  const [pinCode, setPinCode] = useState('')
  const [pinState, setPinState] = useState<'idle' | 'loading' | 'found' | 'error'>('idle')
  const [localities, setLocalities] = useState<string[]>([])
  const [locality, setLocality] = useState('')
  const [city, setCity] = useState('')
  const [addrState, setAddrState] = useState('')
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (params.google !== '1') return
    const pending = getPendingGoogle()
    if (!pending) return setError('Google sign-up session expired. Please try again.')
    setGoogleIdToken(pending.idToken)
    setEmail(pending.profile.email || '')
    setFirstName(pending.profile.firstName || '')
    setLastName(pending.profile.lastName || '')
    setStep('details')
  }, [params.google])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(id)
  }, [resendCooldown])

  const toPending = () => router.replace({ pathname: '/business/pending', params: { status: 'pending', applied: '1' } })
  const alreadyRegistered = () =>
    router.replace({ pathname: '/(auth)/business-login', params: { email, notice: 'already_registered' } })

  function handlePin(val: string) {
    const digits = val.replace(/\D/g, '').slice(0, 6)
    setPinCode(digits)
    if (pinTimer.current) clearTimeout(pinTimer.current)
    if (digits.length < 6) {
      setPinState('idle')
      setLocalities([])
      setLocality('')
      setCity('')
      setAddrState('')
      return
    }
    pinTimer.current = setTimeout(async () => {
      setPinState('loading')
      try {
        const data = await lookupPincode(digits)
        const offices = (data.postOffices || []).filter(Boolean)
        setCity(data.district || '')
        setAddrState(data.state || '')
        setLocalities(offices)
        setLocality(offices[0] || '')
        setPinState('found')
      } catch {
        setPinState('error')
        setLocalities([])
        setLocality('')
      }
    }, 400)
  }

  async function sendCode(isResend: boolean) {
    const res = await requestOtp({ email: email.trim(), channel: 'email', isSignup: true, userType: 'business' })
    if (!res.ok) {
      if (res.status === 429 && typeof res.data.retryAfter === 'number') {
        setResendCooldown(res.data.retryAfter)
        if (!isResend) setStep('otp')
      }
      if (res.data.userExists) {
        alreadyRegistered()
        return null
      }
      throw new Error(res.data.error || (isResend ? 'Failed to resend the code' : 'Failed to send the code'))
    }
    return res.data
  }

  async function handleSendOtp() {
    setError('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address')
    setIsLoading(true)
    try {
      const data = await sendCode(false)
      if (!data) return
      setStep('otp')
      setResendCooldown(typeof data.nextCooldown === 'number' ? data.nextCooldown : 30)
    } catch (err: any) {
      setError(err?.message || 'Failed to send the code')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleResend() {
    setError('')
    setOtp('')
    submittedOtp.current = ''
    setIsLoading(true)
    try {
      const data = await sendCode(true)
      if (!data) return
      setResendCooldown(typeof data.nextCooldown === 'number' ? data.nextCooldown : 60)
      showToast('New code sent', 'success')
      setTimeout(() => otpRef.current?.focus(), 0)
    } catch (err: any) {
      setError(err?.message || 'Failed to resend the code')
    } finally {
      setIsLoading(false)
    }
  }

  async function verifyOtp(value: string) {
    if (submittedOtp.current === value || !policyAccepted) return
    submittedOtp.current = value
    setError('')
    setIsLoading(true)
    try {
      const res = await verifyEmailOtp(email.trim(), value)
      if (!res.ok) throw new Error(res.data.error || 'Invalid code')
      setStep('details')
    } catch (err: any) {
      setError(err?.message || 'Invalid code. Please try again.')
      setShake(n => n + 1)
      setOtp('')
      submittedOtp.current = ''
      setTimeout(() => otpRef.current?.focus(), 0)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (step !== 'otp' || otp.length !== 6 || isLoading || !policyAccepted) return
    verifyOtp(otp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp, step, isLoading, policyAccepted])

  async function handleGoogle() {
    setError('')
    setGoogleLoading(true)
    try {
      const idToken = await googleSignInIdToken()
      if (!idToken) return
      const res = await businessGoogle(idToken)
      if (!res.ok) throw new Error(res.data.error || 'Google sign-in failed')
      const data = res.data
      if (data.newUser && data.profile) {
        setGoogleIdToken(idToken)
        setEmail(data.profile.email || '')
        setFirstName(data.profile.firstName || '')
        setLastName(data.profile.lastName || '')
        setStep('details')
        return
      }
      // Already applied with this Google account.
      if (data.approvalStatus !== 'approved' || !data.user || !data.token) {
        router.replace({ pathname: '/business/pending', params: { status: data.approvalStatus || 'pending' } })
        return
      }
      await finishSignIn(data.user, data.token, 'business')
      router.replace('/(tabs)')
    } catch (err: any) {
      setError(err?.message || 'Google sign-in failed')
    } finally {
      setGoogleLoading(false)
    }
  }

  async function handleDetails() {
    setError('')
    const gst = gstNumber.trim().toUpperCase()
    if (!firstName.trim()) return setError('First name is required')
    if (phone.length !== 10) return setError('Enter a valid 10-digit mobile number')
    if (!isValidDob(dob)) return setError('Enter a valid date of birth')
    if (!companyName.trim()) return setError('Company name is required')
    if (!GSTIN.test(gst)) return setError('Enter a valid 15-character GST number')
    if (!industry) return setError('Please select an industry')
    if (!addressLine1.trim()) return setError('Enter the business address')
    if (pinCode.length !== 6) return setError('Enter a valid 6-digit PIN code')
    if (!city.trim() || !addrState.trim()) return setError('Enter the city and state')
    if (googleIdToken && !policyAccepted) return setError('Please accept the Privacy Policy and Terms & Conditions')

    const details: BusinessDetails = {
      firstName: firstName.trim(),
      lastName: lastName.trim() || undefined,
      phone: googleIdToken ? `+91${phone}` : phone,
      dateOfBirth: dob,
      companyName: companyName.trim(),
      gstNumber: gst,
      businessAddress: [addressLine1, locality, landmark, city, addrState, pinCode].map(s => s.trim()).filter(Boolean).join(', '),
      industry,
    }
    setIsLoading(true)
    try {
      if (googleIdToken) {
        const res = await businessGoogleComplete({ ...details, idToken: googleIdToken })
        if (!res.ok) {
          if (res.status === 409) return alreadyRegistered()
          throw new Error(res.data.error || 'Sign-up failed')
        }
        setPendingGoogle(null)
        // The web confirms the new number before showing the pending page; that needs the new session.
        if (res.data.user && res.data.token) {
          await finishSignIn(res.data.user, res.data.token, 'business')
          setShowPhoneVerify(true)
        } else toPending()
        return
      }
      const res = await businessSignup({ ...details, email: email.trim() })
      if (!res.ok) {
        if (res.status === 400 && res.data.error?.includes('already exists')) return alreadyRegistered()
        throw new Error(res.data.error || 'Sign-up failed')
      }
      toPending()
    } catch (err: any) {
      setError(err?.message || 'Sign-up failed')
    } finally {
      setIsLoading(false)
    }
  }

  // A pending application has nothing to use yet; its session ends once the phone is confirmed.
  async function finishGoogle() {
    setShowPhoneVerify(false)
    await useAuthStore.getState().clearAuth()
    toPending()
  }

  const title = step === 'otp' ? 'Enter the code' : step === 'details' ? 'Business details' : 'Apply for a business account'
  const subtitle =
    step === 'otp'
      ? `We sent a 6-digit code to ${email.trim()}.`
      : step === 'details'
        ? 'Tell us about your business. We review applications within 24–48 hours.'
        : `Apply once for trade pricing, bulk quotes and GST invoicing in your company's name at ${storeName}.`

  return (
    <AuthScreen title={title} subtitle={subtitle}>
      {step === 'email' && (
        <View className="gap-4">
          <TextField
            label="Business email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            placeholder="you@company.com"
            autoFocus={!params.email}
            returnKeyType="done"
            onSubmitEditing={handleSendOtp}
          />
          <FieldError message={error} />
          <Button label="Continue" loadingLabel="Sending code…" loading={isLoading} onPress={handleSendOtp} />
          {!!GOOGLE_WEB_CLIENT_ID && <GoogleRow label="Sign up with Google" loading={googleLoading} onPress={handleGoogle} />}
          <Text className="text-center text-sm text-foreground-secondary">
            Already applied?{' '}
            <Text
              accessibilityRole="link"
              className="font-semibold text-accent-600 dark:text-accent-400"
              onPress={() => router.replace({ pathname: '/(auth)/business-login', params: email.trim() ? { email: email.trim() } : {} })}
            >
              Business sign in
            </Text>
          </Text>
          <TermsNote />
        </View>
      )}

      {step === 'otp' && (
        <View className="gap-5">
          <View>
            <OtpField value={otp} onChange={setOtp} inputRef={otpRef} shake={shake} />
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
            <TextButton
              label="Change email"
              tone="muted"
              onPress={() => {
                setOtp('')
                setError('')
                setStep('email')
              }}
            />
          </View>
          <PolicyConsent checked={policyAccepted} onChange={setPolicyAccepted} />
          <Button
            label="Verify"
            loadingLabel="Verifying…"
            loading={isLoading}
            disabled={otp.length !== 6 || !policyAccepted}
            onPress={() => otp.length === 6 && verifyOtp(otp)}
          />
        </View>
      )}

      {step === 'details' && (
        <View className="gap-4">
          {!!googleIdToken && (
            <Notice>
              <Text className="text-sm leading-5 text-accent-800 dark:text-accent-200">
                No business account for <Text className="font-bold">{email}</Text>. Add your company details to apply.
              </Text>
            </Notice>
          )}
          <View className="flex-row gap-3">
            <TextField label="First name" required containerClassName="flex-1" value={firstName} onChangeText={setFirstName} autoCapitalize="words" autoComplete="given-name" />
            <TextField label="Last name" containerClassName="flex-1" value={lastName} onChangeText={setLastName} autoCapitalize="words" autoComplete="family-name" />
          </View>
          <PhoneField
            label="Mobile number"
            required
            value={phone}
            onChange={setPhone}
            placeholder="Mobile number"
            keyboardType="number-pad"
            error={phone.length > 0 && phone.length !== 10 ? 'Enter a valid 10-digit mobile number' : null}
          />
          <DobInput
            label="Date of birth"
            required
            value={dob}
            onChange={setDob}
            placeholder="Select your date of birth"
            error={dob.length > 0 && !isValidDob(dob) ? 'Enter a valid date of birth' : null}
          />
          <TextField label="Company name" required value={companyName} onChangeText={setCompanyName} autoCapitalize="words" autoComplete="organization" />
          <TextField
            label="GST number"
            required
            value={gstNumber}
            onChangeText={v => setGstNumber(v.toUpperCase().replace(/\s/g, ''))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={15}
            placeholder="22AAAAA0000A1Z5"
            error={gstNumber.length === 15 && !GSTIN.test(gstNumber) ? 'This doesn’t look like a valid GST number' : null}
          />
          <SelectField label="Industry" required value={industry} options={INDUSTRIES} onChange={setIndustry} placeholder="Select industry…" sheetTitle="Industry" />
          <TextField label="Address" required value={addressLine1} onChangeText={setAddressLine1} placeholder="Building, street, area" autoComplete="street-address" />
          <View className="flex-row gap-3">
            <TextField
              label="PIN code"
              required
              containerClassName="flex-1"
              value={pinCode}
              onChangeText={handlePin}
              keyboardType="number-pad"
              maxLength={6}
              helper={pinState === 'loading' ? 'Looking up…' : undefined}
              error={pinState === 'error' ? 'PIN not found. Enter the city and state.' : null}
            />
            <TextField label="Landmark" containerClassName="flex-1" value={landmark} onChangeText={setLandmark} />
          </View>
          {localities.length > 1 && (
            <SelectField label="Locality" value={locality} options={localities.map(l => ({ value: l, label: l }))} onChange={setLocality} sheetTitle="Locality" />
          )}
          <View className="flex-row gap-3">
            <TextField label="City" required containerClassName="flex-1" value={city} onChangeText={setCity} editable={pinState !== 'found' || !city} />
            <TextField label="State" required containerClassName="flex-1" value={addrState} onChangeText={setAddrState} editable={pinState !== 'found' || !addrState} />
          </View>
          {!!googleIdToken && <PolicyConsent checked={policyAccepted} onChange={setPolicyAccepted} />}
          <FieldError message={error} />
          <Button label="Submit application" loadingLabel="Submitting…" loading={isLoading} onPress={handleDetails} />
        </View>
      )}

      {showPhoneVerify && <PhoneVerifyModal requiresPolicy={false} onVerified={finishGoogle} onCancel={finishGoogle} />}
    </AuthScreen>
  )
}
