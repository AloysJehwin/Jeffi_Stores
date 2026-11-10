// Razorpay Checkout `config.display` presets. A screen that shows its own UPI section hides UPI inside
// Checkout so the method never appears twice; subscriptions use Checkout's UPI Autopay as the UPI section.

export interface RazorpayDisplayConfig {
  display: {
    blocks?: Record<string, { name: string; instruments: { method: string; flows?: string[] }[] }>
    sequence?: string[]
    hide?: { method: string }[]
    preferences?: { show_default_blocks: boolean }
  }
}

/** Hides UPI in Checkout when `hideUpi`; otherwise no override (undefined, so the option is omitted). */
export function razorpayDisplayConfig({ hideUpi }: { hideUpi: boolean }): RazorpayDisplayConfig | undefined {
  if (!hideUpi) return undefined
  return { display: { hide: [{ method: 'upi' }], preferences: { show_default_blocks: true } } }
}

/** Only a "UPI Autopay" block (recurring UPI mandate) for subscription checkouts. */
export function upiAutopayDisplayConfig(): RazorpayDisplayConfig {
  return {
    display: {
      blocks: { upi: { name: 'UPI Autopay', instruments: [{ method: 'upi' }] } },
      sequence: ['block.upi'],
      preferences: { show_default_blocks: false },
    },
  }
}

/** Cards, net banking, wallets, EMI — everything but UPI. */
export function otherDisplayConfig(): RazorpayDisplayConfig {
  return razorpayDisplayConfig({ hideUpi: true })!
}
