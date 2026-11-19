// India's PAN and GSTIN, checked by shape: the onboarding forms, the routes that save them and the admin KYC tab.

/** 5 letters, 4 digits, a letter: ABCDE1234F. */
export const PAN_SHAPE = /^[A-Z]{5}[0-9]{4}[A-Z]$/
/** State code, PAN, entity number, a letter or digit, check character. The shape lib/payments/razorpay-route.ts sends to Razorpay. */
export const GSTIN_SHAPE = /^[0123][0-9][A-Z]{5}[0-9]{4}[A-Z][0-9][A-Z0-9][A-Z0-9]$/

export const PAN_MESSAGE = 'Enter your PAN as 5 letters, 4 digits and a letter, like ABCDE1234F.'
export const GSTIN_MESSAGE = 'Enter your 15-character GSTIN, like 29ABCDE1234F1Z5, or leave it blank.'

export const isPan = (v: string | null | undefined): boolean => PAN_SHAPE.test(v ?? '')
export const isGstin = (v: string | null | undefined): boolean => GSTIN_SHAPE.test(v ?? '')

/** What a PAN or GSTIN field keeps of what is typed or pasted: letters and digits, in capitals. */
export const taxIdInput = (v: string, max: number): string =>
  v
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, max)
