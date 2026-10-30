'use client'

import { useHasScope } from '@/contexts/AdminScopesContext'
import { ap } from '@/lib/shared/admin-path'
import type { DashboardAnalytics } from '@/lib/queries'
import { Section, DonutSplit, RankedBars, HourBars, CompactStat, MiniStat, rs, rsCompact, pctStr, numStr, delta } from '@/components/admin/kit'
import { SectionLink } from './SectionLink'

const SOURCE_LABELS: Record<string, string> = {
  online: 'Online store',
  offline: 'Counter / offline',
  pos: 'Point of sale',
  business: 'Business portal',
  amazon: 'Amazon',
}
const sourceLabel = (s: string) => SOURCE_LABELS[s] || s.replace(/_/g, ' ')

export default function GrowthInsights({ data, host }: { data: DashboardAnalytics; host: string }) {
  const {
    conversion: cv,
    engagement: e,
    promotions: p,
    carts: k,
    health: h,
    cash,
    attention: a,
    byHour,
    trafficByHour,
    bySource,
    topStates,
  } = data.insights
  const canCustomers = useHasScope('customers:read')
  const canCoupons = useHasScope('coupons:read')
  const canFinancial = useHasScope('financial:read')
  const canTraffic = useHasScope('traffic:read')
  const canCrm = useHasScope('crm:read')
  const canQuotes = useHasScope('quotations:read')
  const canRfqs = useHasScope('business_rfqs:read')
  const canInventory = useHasScope('inventory:read')
  const canInvoices = useHasScope('invoices:read')
  const healthTotal = h.healthy + h.rising + h.high
  const shippingRecovery = cash.shippingCost > 0 ? Math.round((cash.shippingCharged / cash.shippingCost) * 100) : null

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Section title="Acquisition & Traffic" action={<SectionLink href={canTraffic ? ap('/admin/traffic', host) : undefined} label={canTraffic ? 'Traffic' : undefined} />}>
          <div className="grid grid-cols-2 gap-2">
            <CompactStat
              label="Sessions"
              value={numStr(cv.sessions)}
              sub={`Prev ${numStr(cv.sessionsPrev)}`}
              pct={delta(cv.sessions, cv.sessionsPrev)}
            />
            <CompactStat
              label="Product views"
              value={numStr(cv.productViews)}
              sub={`Prev ${numStr(cv.productViewsPrev)}`}
              pct={delta(cv.productViews, cv.productViewsPrev)}
            />
            <CompactStat
              label="Sign-ups"
              value={numStr(e.signups)}
              sub={`Prev ${numStr(e.signupsPrev)}`}
              pct={e.signupsPct}
              href={canCustomers ? ap('/admin/customers', host) : undefined}
            />
            <CompactStat
              label="Paid orders"
              value={numStr(cv.paidOrders)}
              sub={`Prev ${numStr(cv.paidOrdersPrev)}`}
              pct={delta(cv.paidOrders, cv.paidOrdersPrev)}
              href={ap('/admin/orders', host)}
            />
          </div>
          <div className="mt-3 pt-3 border-t border-border-default space-y-0.5">
            <MiniStat
              label="Session to online paid order"
              value={pctStr(cv.rate, 2)}
              sub={cv.ratePrev != null ? `prev ${pctStr(cv.ratePrev, 2)}` : undefined}
            />
            <MiniStat
              label="New vs returning buyers"
              value={`${numStr(data.customerSplit.newCustomers)} / ${numStr(data.customerSplit.returningCustomers)}`}
              href={canCustomers ? ap('/admin/customers', host) : undefined}
            />
          </div>
        </Section>

        <Section title="Promotions" action={<SectionLink href={canCoupons ? ap('/admin/coupons', host) : undefined} label={canCoupons ? 'Coupons' : undefined} />}>
          <div className="space-y-0.5">
            <MiniStat
              label="Discounts given"
              value={rs(p.discountTotal)}
              sub={p.discountPctOfRevenue != null ? `${pctStr(p.discountPctOfRevenue)} of gross sales` : undefined}
            />
            <MiniStat label="Discounted orders" value={numStr(p.discountedOrders)} />
            <MiniStat
              label="Coupon redemptions"
              value={numStr(p.couponUses)}
              sub={p.couponUses ? `${rs(p.couponDiscount)} off` : undefined}
              href={canCoupons ? ap('/admin/coupons', host) : undefined}
            />
          </div>
          {p.topCoupons.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border-default">
              <RankedBars
                barClass="bg-pink-500"
                items={p.topCoupons.map(c => ({
                  name: c.code,
                  value: c.uses,
                  sub: `${c.uses} uses, ${rs(c.discount)}`,
                }))}
              />
            </div>
          )}
        </Section>

        <Section title="Carts" action={<SectionLink href={canCustomers ? ap('/admin/customers', host) : undefined} label={canCustomers ? 'Customers' : undefined} />}>
          <div className="grid grid-cols-2 gap-2">
            <CompactStat label="Active carts" value={numStr(k.activeCarts)} sub={rsCompact(k.cartValue)} />
            <CompactStat
              label="Abandoned"
              value={numStr(k.abandonedCarts)}
              sub={`${rsCompact(k.abandonedValue)}, idle 1 day+`}
              tone={k.abandonedCarts ? 'text-amber-600 dark:text-amber-400' : undefined}
            />
          </div>
          <div className="mt-3 pt-3 border-t border-border-default space-y-0.5">
            <MiniStat label="Saved for later" value={numStr(k.savedForLater)} sub="items" />
            <MiniStat
              label="Cart to order"
              value={
                k.activeCarts + cv.paidOrders > 0
                  ? pctStr((cv.paidOrders / (k.activeCarts + cv.paidOrders)) * 100, 0)
                  : 'n/a'
              }
              sub="paid orders vs open carts"
            />
          </div>
        </Section>

        <Section title="Customer Health" action={<SectionLink href={canCrm ? ap('/admin/crm', host) : undefined} label={canCrm ? 'CRM' : undefined} />}>
          {healthTotal === 0 ? (
            <p className="text-xs text-foreground-muted py-4 text-center">
              Health scores appear after the first nightly computation.
            </p>
          ) : (
            <DonutSplit
              size={120}
              centerValue={h.avgScore != null ? `${h.avgScore}` : String(healthTotal)}
              centerLabel={h.avgScore != null ? 'avg score / 100' : 'scored'}
              segments={[
                { label: `Healthy (${h.healthy})`, value: h.healthy, color: 'rgb(16 185 129)' },
                { label: `Rising concern (${h.rising})`, value: h.rising, color: 'rgb(245 158 11)' },
                { label: `High churn risk (${h.high})`, value: h.high, color: 'rgb(239 68 68)' },
              ]}
            />
          )}
        </Section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Section title="Peak Hours" action={<SectionLink href={ap('/admin/orders', host)} label="Orders" />}>
          <div className="space-y-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted mb-1.5">
                Orders by hour
              </p>
              <HourBars counts={byHour} unit="orders" />
            </div>
            <div className="pt-3 border-t border-border-default/70">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted mb-1.5">
                Traffic by hour
              </p>
              <HourBars counts={trafficByHour} tone="sky" unit="visits" />
            </div>
          </div>
        </Section>

        <Section title="Channels & Regions">
          <div className="space-y-0.5">
            {bySource.length === 0 && <p className="text-xs text-foreground-muted py-2">No orders in this range.</p>}
            {bySource.map(s => (
              <MiniStat key={s.source} label={sourceLabel(s.source)} value={numStr(s.orders)} sub={rs(s.revenue)} />
            ))}
          </div>
          {topStates.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border-default">
              <p className="text-[11px] uppercase tracking-wide text-foreground-muted font-medium mb-2">
                Top shipping states
              </p>
              <RankedBars
                barClass="bg-sky-500"
                items={topStates.map(s => ({
                  name: s.state,
                  value: s.orders,
                  sub: `${s.orders} orders, ${rsCompact(s.revenue)}`,
                }))}
              />
            </div>
          )}
        </Section>

        <Section title={canFinancial ? 'Cash & Costs' : 'Pipeline'} action={<SectionLink href={canFinancial ? ap('/admin/financial', host) : undefined} label={canFinancial ? 'Financial' : undefined} />}>
          <div className="space-y-0.5">
            {canFinancial && (
              <>
                <MiniStat label="GST collected" value={rs(cash.gstCollected)} href={ap('/admin/gst', host)} />
                <MiniStat
                  label="Shipping charged vs cost"
                  value={`${rsCompact(cash.shippingCharged)} / ${rsCompact(cash.shippingCost)}`}
                  sub={shippingRecovery != null ? `${shippingRecovery}% recovered` : undefined}
                  tone={
                    shippingRecovery != null && shippingRecovery < 100
                      ? 'text-amber-600 dark:text-amber-400'
                      : undefined
                  }
                />
                <MiniStat label="COD fees collected" value={rs(cash.codFees)} />
                {canInvoices && (
                  <MiniStat
                    label="Cash sales"
                    value={numStr(cash.cashSales)}
                    sub={rs(cash.cashSalesValue)}
                    href={ap('/admin/cash-sale', host)}
                  />
                )}
                <MiniStat label="Expenses in range" value={rs(cash.expenses)} href={ap('/admin/financial', host)} />
                <MiniStat
                  label="Overdue bills"
                  value={numStr(a.overdueBills)}
                  sub={a.overdueBills ? rs(cash.overdueBillsAmount) : undefined}
                  tone={a.overdueBills ? 'text-red-500' : undefined}
                  href={ap('/admin/financial', host)}
                />
              </>
            )}
            {canQuotes && (
              <MiniStat
                label="Open quotations"
                value={numStr(cash.openQuotes)}
                sub={cash.openQuotes ? rsCompact(cash.openQuotesValue) : undefined}
                href={ap('/admin/quotations', host)}
              />
            )}
            {canRfqs && (
              <MiniStat
                label="Pending RFQs"
                value={numStr(a.pendingRfqs)}
                tone={a.pendingRfqs ? 'text-amber-600 dark:text-amber-400' : undefined}
                href={ap('/admin/business/rfqs', host)}
              />
            )}
            {canInventory && (
              <MiniStat
                label="Open purchase orders"
                value={numStr(cash.openPos)}
                sub={cash.openPos ? rsCompact(cash.openPosValue) : undefined}
                href={ap('/admin/inventory/po', host)}
              />
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}
