import type { ParamDef } from './types'
import { days, hours, minutes } from './duration'

// The per-user cooldown is stored as canonical MINUTES under `sendCooldown`. The legacy integer key
// `sendCooldownDays` (days) is still read by cooldownMinutes() for campaigns saved before the migration,
// so no data migration is needed. Default = 1 day.
// The per-person cap is off by default (0): a person who keeps qualifying gets one email per cooldown.
export const UNIVERSAL_DEFAULTS: Record<string, number | boolean | string> = {
  sendCooldown: days(1),
  maxRecipientsPerSweep: 50,
  maxSendsPerPerson: 0,
  maxSendsWindow: days(30),
}

export const UNIVERSAL_SCHEMA: Record<string, ParamDef> = {
  sendCooldown: {
    type: 'duration',
    min: minutes(1),
    max: days(30),
    recommendedUnit: 'days',
    label: 'Per-user cooldown',
    description: 'Skip users sent this campaign within this window',
  },
  maxRecipientsPerSweep: {
    type: 'integer',
    min: 1,
    max: 500,
    label: 'Max recipients per run',
    description: 'Hard limit per sweep',
  },
  maxSendsPerPerson: {
    type: 'integer',
    min: 0,
    max: 1000,
    label: 'Max emails per person',
    description: 'At most this many emails of this campaign to one person within the cap window (0 = no limit; the cooldown still applies)',
  },
  maxSendsWindow: {
    type: 'duration',
    min: hours(1),
    max: days(365),
    recommendedUnit: 'days',
    label: 'Cap window',
    description: 'The rolling window the per-person cap counts emails in',
  },
}
