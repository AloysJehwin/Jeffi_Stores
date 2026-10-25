import { buildWinbackScenario } from './_winback-base'
import { days } from '../duration'

export const winback180 = buildWinbackScenario({
  kind: 'winback_180',
  name: 'Win-Back (180 days, dormant)',
  description: "Customer hasn't ordered in 180+ days — last chance",
  trigger:
    'Same logic as Win-Back 90 but for the deeper dormant window: last paid order between 150 and 365 days ago. No health-score cut by default, since being gone this long already makes a customer dormant (and the score never drops much below 30 for anyone who has ordered, so the old under-25 cut matched nobody). Coupon required. Treated as a last-chance campaign with a stronger discount.',
  defaults: {
    minDaysSinceOrder: days(150),
    maxDaysSinceOrder: days(365),
    healthScoreMin: 0,
    // Exclusive upper bound, so 100 is never reached by a customer this lapsed (recency caps it near 70).
    healthScoreMax: 100,
    maxRecipientsPerSweep: 50,
    whatsappEnabled: false,
    smsEnabled: false,
    pushEnabled: false,
  },
})
