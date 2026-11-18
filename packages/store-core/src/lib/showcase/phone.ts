// A visitor's phone number as call and WhatsApp links (the owner's enquiries page and email). Both want the country
// code: a 10-digit Indian number, or one written 0XXXXXXXXXX or 91XXXXXXXXXX, gets 91. No database here, so client
// components can use it.

/** The number with its country code, digits only; '' when it can't be told. */
export function intlDigits(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const full = phone.trim().startsWith('+')
    ? digits
    : digits.length === 10
      ? `91${digits}`
      : digits.length === 11 && digits.startsWith('0')
        ? `91${digits.slice(1)}`
        : digits.length === 12 && digits.startsWith('91')
          ? digits
          : ''
  return /^\d{8,15}$/.test(full) ? full : ''
}

/** tel: for any 6–15 digit number; wa.me only when the country code is known. */
export function phoneLinks(phone: string): { tel: string; whatsapp: string } {
  const full = intlDigits(phone)
  const digits = phone.replace(/\D/g, '')
  return {
    tel: full ? `tel:+${full}` : digits.length >= 6 && digits.length <= 15 ? `tel:${digits}` : '',
    whatsapp: full ? `https://wa.me/${full}` : '',
  }
}
