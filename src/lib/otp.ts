import redis from './redis'

const OTP_EXPIRY = 600 // 10 minutes in seconds
const MAX_ATTEMPTS = 5

// Generate 6-digit OTP
export function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

// Store OTP with 10-minute expiry in Redis
export async function storeOTP(email: string, otp: string): Promise<void> {
  const normalizedEmail = email.toLowerCase()
  const otpKey = `otp:${normalizedEmail}`
  const attemptsKey = `otp:attempts:${normalizedEmail}`
  
  // Store OTP with expiry
  await redis.set(otpKey, otp, 'EX', OTP_EXPIRY)
  
  // Reset attempts counter with same expiry
  await redis.set(attemptsKey, '0', 'EX', OTP_EXPIRY)
}

// Verify OTP
export async function verifyOTP(email: string, otp: string): Promise<{
  valid: boolean
  message: string
}> {
  const normalizedEmail = email.toLowerCase()
  const otpKey = `otp:${normalizedEmail}`
  const attemptsKey = `otp:attempts:${normalizedEmail}`
  const verifiedKey = `otp:verified:${normalizedEmail}`

  // Get stored OTP
  const storedOtp = await redis.get(otpKey)
  
  if (!storedOtp) {
    return { valid: false, message: 'No OTP found. Please request a new one.' }
  }

  // Check attempts
  const attempts = parseInt(await redis.get(attemptsKey) || '0')
  if (attempts >= MAX_ATTEMPTS) {
    // Delete OTP after too many attempts
    await redis.del(otpKey)
    await redis.del(attemptsKey)
    return { valid: false, message: 'Too many failed attempts. Please request a new OTP.' }
  }

  // Verify OTP
  if (storedOtp !== otp) {
    // Increment attempts
    await redis.incr(attemptsKey)
    return { valid: false, message: 'Invalid OTP. Please try again.' }
  }

  // Valid OTP - mark as verified (keep for signup completion)
  const ttl = await redis.ttl(otpKey)
  await redis.set(verifiedKey, 'true', 'EX', ttl > 0 ? ttl : 300) // Keep verified status for remaining time or 5 min
  
  return { valid: true, message: 'OTP verified successfully' }
}

// Check if OTP was verified (for signup flow)
export async function isOTPVerified(email: string): Promise<boolean> {
  const normalizedEmail = email.toLowerCase()
  const verifiedKey = `otp:verified:${normalizedEmail}`
  const verified = await redis.get(verifiedKey)
  return verified === 'true'
}

// Delete OTP after successful use
export async function deleteOTP(email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase()
  await redis.del(`otp:${normalizedEmail}`)
  await redis.del(`otp:attempts:${normalizedEmail}`)
  await redis.del(`otp:verified:${normalizedEmail}`)
}
