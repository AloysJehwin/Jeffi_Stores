import type { ParamDef } from './types'

export const UNIVERSAL_DEFAULTS: Record<string, number | boolean | string> = {
  sendCooldownDays: 1,
  maxRecipientsPerSweep: 50,
}

export const UNIVERSAL_SCHEMA: Record<string, ParamDef> = {
  sendCooldownDays: {
    type: 'integer',
    min: 1,
    max: 30,
    label: 'Per-user cooldown (days)',
    description: 'Skip users sent this campaign within N days',
  },
  maxRecipientsPerSweep: {
    type: 'integer',
    min: 1,
    max: 500,
    label: 'Max recipients per run',
    description: 'Hard limit per sweep',
  },
}
