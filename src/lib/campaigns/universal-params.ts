import type { ParamDef } from './types'
import { days, hours } from './duration'

// The per-user cooldown is stored as canonical MINUTES under `sendCooldown`. The legacy integer key
// `sendCooldownDays` (days) is still read by cooldownMinutes() for campaigns saved before the migration,
// so no data migration is needed. Default = 1 day.
export const UNIVERSAL_DEFAULTS: Record<string, number | boolean | string> = {
  sendCooldown: days(1),
  maxRecipientsPerSweep: 50,
}

export const UNIVERSAL_SCHEMA: Record<string, ParamDef> = {
  sendCooldown: {
    type: 'duration',
    min: hours(1),
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
}
