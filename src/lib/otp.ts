import redis from './redis'

const OTP_EXPIRY = 600
const MAX_ATTEMPTS = 5

const RESEND_COOLDOWNS_SEC = [30, 60, 120, 300, 600] as const
const RESEND_WINDOW_SEC = 3600

export async function checkSendOtpRateLimit(email: string): Promise<{
  allowed: boolean
  retryAfter: number
  nextCooldown: number
}> {
  const normalizedEmail = email.toLowerCase()
  const lastKey = `otp:lastSend:${normalizedEmail}`
  const countKey = `otp:sendCount:${normalizedEmail}`

  const now = Math.floor(Date.now() / 1000)
  const lastSendStr = await redis.get(lastKey)
  const lastSend = lastSendStr ? parseInt(lastSendStr) : 0
  const sendCount = parseInt((await redis.get(countKey)) || '0')

  const currentCooldownIdx = Math.max(0, Math.min(sendCount - 1, RESEND_COOLDOWNS_SEC.length - 1))
  const currentCooldown = sendCount === 0 ? 0 : RESEND_COOLDOWNS_SEC[currentCooldownIdx]
  const elapsed = now - lastSend
  const retryAfter = Math.max(0, currentCooldown - elapsed)

  const nextIdx = Math.min(sendCount, RESEND_COOLDOWNS_SEC.length - 1)
  const nextCooldown = RESEND_COOLDOWNS_SEC[nextIdx]

  if (retryAfter > 0) {
    return { allowed: false, retryAfter, nextCooldown: currentCooldown }
  }

  return { allowed: true, retryAfter: 0, nextCooldown }
}

export async function recordSendOtp(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase()
  const lastKey = `otp:lastSend:${normalizedEmail}`
  const countKey = `otp:sendCount:${normalizedEmail}`
  const now = Math.floor(Date.now() / 1000)
  await redis.set(lastKey, String(now), 'EX', RESEND_WINDOW_SEC)
  await redis.incr(countKey)
  await redis.set(countKey, (await redis.get(countKey)) || '1', 'EX', RESEND_WINDOW_SEC)
}

export async function resetSendOtpCounter(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase()
  await redis.del(`otp:lastSend:${normalizedEmail}`)
  await redis.del(`otp:sendCount:${normalizedEmail}`)
}

export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

export async function storeOTP(email: string, otp: string): Promise<void> {
  const normalizedEmail = email.toLowerCase()
  const otpKey = `otp:${normalizedEmail}`
  const attemptsKey = `otp:attempts:${normalizedEmail}`
  await redis.set(otpKey, otp, 'EX', OTP_EXPIRY)
  await redis.set(attemptsKey, '0', 'EX', OTP_EXPIRY)
}

export async function verifyOTP(
  email: string,
  otp: string
): Promise<{
  valid: boolean
  message: string
}> {
  const normalizedEmail = email.toLowerCase()
  const otpKey = `otp:${normalizedEmail}`
  const attemptsKey = `otp:attempts:${normalizedEmail}`
  const verifiedKey = `otp:verified:${normalizedEmail}`

  const storedOtp = await redis.get(otpKey)

  if (!storedOtp) {
    return { valid: false, message: 'No OTP found. Please request a new one.' }
  }

  const attempts = parseInt((await redis.get(attemptsKey)) || '0')
  if (attempts >= MAX_ATTEMPTS) {
    await redis.del(otpKey)
    await redis.del(attemptsKey)
    return { valid: false, message: 'Too many failed attempts. Please request a new OTP.' }
  }

  if (storedOtp !== otp) {
    await redis.incr(attemptsKey)
    return { valid: false, message: 'Invalid OTP. Please try again.' }
  }

  const ttl = await redis.ttl(otpKey)
  await redis.set(verifiedKey, 'true', 'EX', ttl > 0 ? ttl : 300)

  return { valid: true, message: 'OTP verified successfully' }
}

export async function isOTPVerified(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase()
  const verifiedKey = `otp:verified:${normalizedEmail}`
  const verified = await redis.get(verifiedKey)
  return verified === 'true'
}

export async function deleteOTP(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase()
  await redis.del(`otp:${normalizedEmail}`)
  await redis.del(`otp:attempts:${normalizedEmail}`)
  await redis.del(`otp:verified:${normalizedEmail}`)
}

// Phone OTP — an independent namespace ('phone:' prefix) so verifying a mobile
// number never collides with the email-account OTP. Keyed by the E.164 phone.
function phoneKey(phone: string): string {
  return `phone:${phone.replace(/\D/g, '')}`
}

export async function checkSendPhoneOtpRateLimit(phone: string): Promise<{
  allowed: boolean
  retryAfter: number
  nextCooldown: number
}> {
  const id = phoneKey(phone)
  const lastKey = `otp:lastSend:${id}`
  const countKey = `otp:sendCount:${id}`

  const now = Math.floor(Date.now() / 1000)
  const lastSendStr = await redis.get(lastKey)
  const lastSend = lastSendStr ? parseInt(lastSendStr) : 0
  const sendCount = parseInt((await redis.get(countKey)) || '0')

  const currentCooldownIdx = Math.max(0, Math.min(sendCount - 1, RESEND_COOLDOWNS_SEC.length - 1))
  const currentCooldown = sendCount === 0 ? 0 : RESEND_COOLDOWNS_SEC[currentCooldownIdx]
  const elapsed = now - lastSend
  const retryAfter = Math.max(0, currentCooldown - elapsed)

  const nextIdx = Math.min(sendCount, RESEND_COOLDOWNS_SEC.length - 1)
  const nextCooldown = RESEND_COOLDOWNS_SEC[nextIdx]

  if (retryAfter > 0) {
    return { allowed: false, retryAfter, nextCooldown: currentCooldown }
  }
  return { allowed: true, retryAfter: 0, nextCooldown }
}

export async function recordSendPhoneOtp(phone: string): Promise<void> {
  const id = phoneKey(phone)
  const now = Math.floor(Date.now() / 1000)
  await redis.set(`otp:lastSend:${id}`, String(now), 'EX', RESEND_WINDOW_SEC)
  await redis.incr(`otp:sendCount:${id}`)
  await redis.expire(`otp:sendCount:${id}`, RESEND_WINDOW_SEC)
}

export async function storePhoneOTP(phone: string, otp: string): Promise<void> {
  const id = phoneKey(phone)
  await redis.set(`otp:${id}`, otp, 'EX', OTP_EXPIRY)
  await redis.set(`otp:attempts:${id}`, '0', 'EX', OTP_EXPIRY)
}

export async function verifyPhoneOTP(
  phone: string,
  otp: string
): Promise<{
  valid: boolean
  message: string
}> {
  const id = phoneKey(phone)
  const otpKey = `otp:${id}`
  const attemptsKey = `otp:attempts:${id}`

  const storedOtp = await redis.get(otpKey)
  if (!storedOtp) {
    return { valid: false, message: 'No OTP found. Please request a new one.' }
  }

  const attempts = parseInt((await redis.get(attemptsKey)) || '0')
  if (attempts >= MAX_ATTEMPTS) {
    await redis.del(otpKey)
    await redis.del(attemptsKey)
    return { valid: false, message: 'Too many failed attempts. Please request a new OTP.' }
  }

  if (storedOtp !== otp) {
    await redis.incr(attemptsKey)
    return { valid: false, message: 'Invalid OTP. Please try again.' }
  }

  await redis.del(otpKey)
  await redis.del(attemptsKey)
  return { valid: true, message: 'OTP verified successfully' }
}
