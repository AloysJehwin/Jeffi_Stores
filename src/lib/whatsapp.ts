// Meta WhatsApp Cloud API — OTP sender.
// Requires META_PHONE_NUMBER_ID and META_ACCESS_TOKEN in env.
// Fails silently (returns false) when env vars are missing.

const META_PHONE_ID = process.env.META_PHONE_NUMBER_ID
const META_TOKEN = process.env.META_ACCESS_TOKEN
const STORE_NAME = 'Jeffi Stores'

// Normalize Indian mobile numbers to E.164 format (+91XXXXXXXXXX).
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`
  if (digits.length === 13 && digits.startsWith('091')) return `+91${digits.slice(3)}`
  return null
}

export async function sendOTPWhatsApp(params: { phone?: string | null; otp: string }): Promise<boolean> {
  if (!META_PHONE_ID || !META_TOKEN) return false

  const to = normalizePhone(params.phone)
  if (!to) return false

  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${META_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${META_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: {
          body: `${STORE_NAME}: Your OTP is ${params.otp}. Valid for 10 minutes. Do not share this with anyone.`,
        },
      }),
    })
    return res.ok
  } catch {
    return false
  }
}
