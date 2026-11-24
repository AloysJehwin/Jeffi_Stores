import { listPlans, planFeatureMatrix } from '@/lib/tenant-registry'
import { lowestPlanInr } from '@controller/lib/compute/floor-prices'

export const REVIEW_TIME = 'live 1–2 business days after review'

/** A plan price before GST, as the public pages show it: "₹2,235/mo + GST". */
export const fromLabel = (inr: number) => `₹${inr.toLocaleString('en-IN')}/mo + GST`

/** "Plans from ₹X/mo + GST · live 1–2 business days after review"; no figure when prices can't be computed. */
export function plansLine(fromInr: number | null): string {
  return `${fromInr ? `Plans from ${fromLabel(fromInr)}` : 'Paid monthly plans'} · ${REVIEW_TIME}`
}

/** Active store plans, their scope matrix and the lowest monthly price before GST, each empty/null if the control plane is down. */
export async function loadPlanFacts() {
  const plansP = listPlans().catch(() => [] as Awaited<ReturnType<typeof listPlans>>)
  const [plans, matrix, fromInr] = await Promise.all([
    plansP,
    planFeatureMatrix().catch(() => ({}) as Record<string, Set<string>>),
    plansP.then(ps => lowestPlanInr(ps.map(p => p.slug))),
  ])
  return { plans, matrix, fromInr }
}
