import 'server-only'
import { getWalletBalance } from '@/lib/payments/wallet'
import { legacySpecFor } from '@/lib/compute/legacy'
import { catalogOrDefault, rateFor } from '@controller/lib/compute/resolve'
import { computeSpecEnabled } from '@controller/lib/compute/catalog'
import { getTenantCompute } from '@controller/lib/compute/store'

export interface StorePrepay {
  requiredInr: number // the wallet must hold this before the store is built (0: nothing to prepay)
  dailyInr: number
  days: number
  balance: number
}

/** A new store's servers are prepaid: its wallet must hold minPrepayDays of the servers chosen at onboarding. */
export async function storePrepay(tenantId: string, plan: string | null): Promise<StorePrepay> {
  const { balance } = await getWalletBalance(tenantId)
  if (!computeSpecEnabled()) return { requiredInr: 0, dailyInr: 0, days: 0, balance }
  const spec = (await getTenantCompute(tenantId))?.desired ?? legacySpecFor(plan)
  const [rate, { settings }] = await Promise.all([rateFor(spec), catalogOrDefault()])
  const dailyInr = Math.round((rate ?? 0) * 24 * 100) / 100
  return { requiredInr: Math.ceil(dailyInr * settings.minPrepayDays), dailyInr, days: settings.minPrepayDays, balance }
}
