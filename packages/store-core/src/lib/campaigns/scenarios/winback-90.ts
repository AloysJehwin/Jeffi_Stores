import { buildWinbackScenario } from './_winback-base'
import { days } from '../duration'

export const winback90 = buildWinbackScenario({
  kind: 'winback_90',
  name: 'Win-Back (90 days)',
  description: "Customer hasn't ordered in 90+ days",
  trigger:
    'Fires for users whose last paid order is between minDaysSinceOrder and maxDaysSinceOrder days ago, and whose customer-health score sits in the configured range (or has no score yet). One send per cooldown window. Coupon is required — skipped if coupon generation fails.',
  defaults: {
    minDaysSinceOrder: days(60),
    maxDaysSinceOrder: days(150),
    healthScoreMin: 25,
    healthScoreMax: 50,
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
    smsEnabled: false,
    pushEnabled: false,
  },
})
