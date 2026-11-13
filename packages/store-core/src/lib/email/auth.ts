import 'server-only'
import {
  sendAuditedMail,
  mailShell,
  customerMailFromAsync,
  adminMailFrom,
  currentBrandNameAsync,
  storeContactLine,
  storeAddressLine,
  storeBaseUrlAsync,
} from './shared'

// Plain-text part: the code alone on its own line helps mail clients offer "Copy code".
const otpText = (otp: string, lead: string) =>
  `${lead}\n\n${otp}\n\nIt expires in 10 minutes. Do not share this code with anyone.`

export async function sendOTPEmail(email: string, otp: string, name?: string) {
  const contactLine = await storeContactLine()
  const from = await customerMailFromAsync()
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const subject = `${otp} is your ${brand} verification code`
  const html = mailShell({
    brand,
    kicker: 'Verification Code',
    title: 'Email Verification',
    preheader: `Your ${brand} OTP is ${otp} — valid for 10 minutes. Do not share.`,
    content: `
      <p>Hello ${name || 'Customer'}, your verification code is:</p>

      <div class="code-box">${otp}</div>

      <p>Enter this code to verify your email address.</p>

      <div class="warning">
        <strong>This OTP will expire in 10 minutes.</strong>
        <br>
        <small>Please do not share this code with anyone.</small>
      </div>

      <p>If you didn't request this verification code, please ignore this email or contact our support team.</p>
    `,
    footerLines: [address, contactLine],
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      text: otpText(otp, `Your ${brand} verification code is ${otp}.`),
      kind: 'otp',
      templateName: 'otp',
      redactBody: true,
      entityType: null,
      entityId: null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

/** A mobile-number verification code, by email: the fallback when WhatsApp and SMS can't send it. */
export async function sendPhoneOTPEmail(email: string, otp: string, phone: string, name?: string) {
  const contactLine = await storeContactLine()
  const from = await customerMailFromAsync()
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const html = mailShell({
    brand,
    kicker: 'Verification Code',
    title: 'Verify your mobile number',
    preheader: `Your ${brand} code is ${otp} — valid for 10 minutes. Do not share.`,
    content: `
      <p>Hello ${name || 'Customer'}, your verification code is:</p>

      <div class="code-box">${otp}</div>

      <p>Enter this code to verify your mobile number <strong>+91 ${phone}</strong>.</p>

      <div class="warning">
        <strong>This code will expire in 10 minutes.</strong>
        <br>
        <small>Please do not share this code with anyone.</small>
      </div>

      <p>If you didn't ask to verify this number, please ignore this email or contact our support team.</p>
    `,
    footerLines: [address, contactLine],
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject: `${otp} is your ${brand} mobile verification code`,
      html,
      text: otpText(otp, `Your ${brand} code to verify +91 ${phone} is ${otp}.`),
      kind: 'otp',
      templateName: 'otp',
      redactBody: true,
      entityType: null,
      entityId: null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendAdminOTPEmail(email: string, otp: string, name?: string) {
  const from = adminMailFrom()
  const brand = await currentBrandNameAsync()
  const subject = `${otp} is your ${brand} admin sign-in code`
  const html = mailShell({
    brand,
    kicker: 'Admin Access',
    title: 'Verify your admin sign-in',
    preheader: `${brand} admin sign-in code: ${otp} — valid for 10 minutes. If this wasn't you, do not share it.`,
    content: `
      <p>Hello ${name || 'Admin'}, your sign-in code is:</p>

      <div class="code-box mono">${otp}</div>

      <p>Enter this code to complete sign-in to the admin dashboard.</p>

      <div class="danger">
        <strong>This code authorizes staff access. It expires in 10 minutes.</strong>
        <br>
        <small>If you didn't try to sign in, ignore this email and rotate your credentials.</small>
      </div>
    `,
    footerLines: [`${brand} — administrative access`, 'This is an automated security message. Do not reply.'],
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      text: otpText(otp, `Your ${brand} admin sign-in code is ${otp}.`),
      kind: 'otp',
      templateName: 'admin_otp',
      redactBody: true,
      entityType: null,
      entityId: null,
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}

export async function sendWelcomeEmail(email: string, name: string) {
  const baseUrl = await storeBaseUrlAsync()
  const contactLine = await storeContactLine()
  const from = await customerMailFromAsync()
  const brand = await currentBrandNameAsync()
  const address = await storeAddressLine()
  const subject = `Welcome to ${brand}!`
  const html = mailShell({
    brand,
    kicker: 'Your account is ready',
    title: `Welcome to ${brand}!`,
    preheader: `Welcome to ${brand}! Your account is ready.`,
    content: `
      <p>Hello ${name},</p>
      <p>Thank you for creating an account with us. We're excited to have you on board!</p>

      <p>With your account you can:</p>
      <ul>
        <li>Browse our full catalogue</li>
        <li>Track your orders</li>
        <li>Check out faster</li>
        <li>Get expert service and support</li>
      </ul>

      <div class="cta">
        <a href="${baseUrl}/products" class="button" style="color:#ffffff;">
          Start Shopping
        </a>
      </div>

      <p>If you have any questions or need assistance, feel free to reach out to our team.</p>
    `,
    footerLines: [address, contactLine],
  })

  try {
    const info = await sendAuditedMail({
      from,
      to: email,
      subject,
      html,
      kind: 'welcome',
      templateName: 'welcome',
    })
    return { success: true, messageId: info.messageId }
  } catch (error) {
    return { success: false, error }
  }
}
