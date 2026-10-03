import { buildWinbackScenario } from './_winback-base'
import { days } from '../duration'

export const winback180 = buildWinbackScenario({
  kind: 'winback_180',
  name: 'Win-Back (180 days, dormant)',
  description: "Customer hasn't ordered in 180+ days — last chance",
  trigger:
    'Same logic as Win-Back 90 but for the deeper dormant window — last paid order between 150–365 days ago and a low health score. Coupon required. Treated as a last-chance campaign with a stronger discount.',
  defaults: {
    minDaysSinceOrder: days(150),
    maxDaysSinceOrder: days(365),
    healthScoreMin: 0,
    healthScoreMax: 25,
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
  },
})
