import type { StudioSession } from './sessions'
import { buildRunning } from './sessions'

/** The brief, plan and look are fixed once the site is being built or has pages; tweaks change it from then on. */
export function designLocked(s: StudioSession): string | null {
  if (buildRunning(s)) return 'Your site is being built.'
  if (Object.keys(s.pages ?? {}).length) return 'Your site is built: change it with tweaks, or start over.'
  return null
}
