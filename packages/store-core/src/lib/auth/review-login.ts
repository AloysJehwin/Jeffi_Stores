// App-store review account. Reviewers can't read an emailed code, so send-otp stores this fixed code for
// the one configured email and sends nothing; login checks it like any OTP (10-minute expiry, attempt
// limit, send rate limit). Unset REVIEW_LOGIN_EMAIL or REVIEW_LOGIN_CODE to switch it off.
export function reviewLoginCode(email: string): string | null {
  const reviewEmail = (process.env.REVIEW_LOGIN_EMAIL || '').trim().toLowerCase()
  const code = (process.env.REVIEW_LOGIN_CODE || '').trim()
  if (!reviewEmail || !/^\d{6}$/.test(code)) return null
  return email.trim().toLowerCase() === reviewEmail ? code : null
}
