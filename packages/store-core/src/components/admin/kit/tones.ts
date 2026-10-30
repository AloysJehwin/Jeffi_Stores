// Status tone classes, kept out of the client modules so server components can read them.
export type Tone = 'red' | 'amber' | 'green' | 'blue' | 'muted'

export const TONE_CLS: Record<Tone, string> = {
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  green: 'bg-green-500/10 text-green-700 dark:text-green-400',
  blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  muted: 'bg-surface-secondary text-foreground-muted',
}

export const badgeCls = (tone: Tone = 'muted') => `inline-block rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${TONE_CLS[tone]}`
