// Barrel for the finance-wide primitives: shared period hook, period bar, aging donut, and the
// response contract type every finance overview API returns.

export {
  FINANCE_PRESETS,
  parsePresetFromUrl,
  rangeFromUrl,
  useFinancePeriod,
  type FinancePreset,
  type UseFinancePeriod,
} from './finance-period'
export { FinancePeriodBar } from './FinancePeriodBar'
export {
  AGING_COLORS,
  AGING_PALETTE,
  AgingDonutCard,
  type AgingDonutRow,
} from './AgingDonutCard'
export {
  isFinanceOverview,
  type FinanceBucket,
  type FinanceOverviewContract,
  type FinanceRange,
} from './finance-overview-contract'
