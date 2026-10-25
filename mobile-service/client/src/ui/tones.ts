// Status colours as class pairs (bg + text), literal strings so NativeWind compiles them.
export type Tone = 'neutral' | 'accent' | 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'progress' | 'transit' | 'digital'

export const TONES: Record<Tone, { bg: string; text: string; solid: string }> = {
  neutral: { bg: 'bg-surface-secondary', text: 'text-foreground-secondary', solid: 'bg-secondary-500' },
  accent: { bg: 'bg-accent-50 dark:bg-accent-900/30', text: 'text-accent-700 dark:text-accent-300', solid: 'bg-accent-500' },
  brand: { bg: 'bg-primary-50 dark:bg-primary-900/30', text: 'text-primary-800 dark:text-primary-300', solid: 'bg-primary-500' },
  success: { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-800 dark:text-green-300', solid: 'bg-green-600' },
  warning: { bg: 'bg-yellow-100 dark:bg-yellow-900/30', text: 'text-yellow-800 dark:text-yellow-300', solid: 'bg-yellow-600' },
  danger: { bg: 'bg-red-100 dark:bg-red-900/30', text: 'text-red-800 dark:text-red-300', solid: 'bg-red-600' },
  info: { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-800 dark:text-blue-300', solid: 'bg-blue-600' },
  progress: { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-800 dark:text-orange-300', solid: 'bg-orange-600' },
  transit: { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-800 dark:text-purple-300', solid: 'bg-purple-600' },
  digital: { bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-800 dark:text-violet-300', solid: 'bg-violet-600' },
}

const ORDER: Record<string, Tone> = {
  pending: 'warning', unpaid: 'warning',
  confirmed: 'info', processing: 'info', return_approved: 'info', return_received: 'info',
  shipped: 'transit', dispatched: 'transit', returned: 'transit', refunded: 'transit',
  out_for_delivery: 'info',
  delivered: 'success', granted: 'success', paid: 'success', completed: 'success',
  cancel_requested: 'progress', return_requested: 'progress',
  cancelled: 'danger', failed: 'danger', return_rejected: 'danger',
}

/** Tone for an order or payment status. */
export function statusTone(status: string | null | undefined): Tone {
  return (status && ORDER[status]) || 'neutral'
}
