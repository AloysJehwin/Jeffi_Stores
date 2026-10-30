'use client'

import { Kpi, Section, count, pct } from '@/components/admin/channels/ui'
import { delta, ratio } from '@/lib/overview/period'
import type { AttentionItem } from '@/components/admin/overview/kit'
import { OverviewTab } from '../products/_components/catalog-overview'

interface Stats {
  proposed: number
  products: number
  approved: number
  rejected: number
  failed: number
  tokens: number
  approvalRate: number | null
}

interface EnrichmentOverviewData {
  current: Stats
  previousStats: Stats
  state: {
    pending: number
    pendingStale: number
    active: number
    enriched: number
    fields: Record<string, number>
    fieldsFilled: number | null
  }
  attention: AttentionItem[]
}

const FIELD_LABEL: Record<string, string> = {
  ai_description: 'Description',
  ai_use_cases: 'Use cases',
  ai_keywords: 'Keywords',
  ai_who_uses_it: 'Who uses it',
  ai_application: 'Application',
  ai_product_type: 'Product type',
  ai_features: 'Features',
  ai_search_tags: 'Search tags',
}

export default function EnrichmentOverview() {
  return (
    <OverviewTab<EnrichmentOverviewData>
      endpoint="/api/admin/catalog-enrichment/overview"
      kpis={d => (
        <>
          <Kpi
            label="Products enriched"
            value={count(d.current.products)}
            delta={delta(d.current.products, d.previousStats.products)}
            sub={`${count(d.current.proposed)} suggestions`}
          />
          <Kpi
            label="Pending approval"
            value={count(d.state.pending)}
            sub={d.state.pendingStale ? `${count(d.state.pendingStale)} over 7 days` : undefined}
          />
          <Kpi
            label="Approval rate"
            value={pct(d.current.approvalRate, 0)}
            sub={`${count(d.current.approved)} approved, ${count(d.current.rejected)} rejected`}
          />
          <Kpi
            label="Failed"
            value={count(d.current.failed)}
            delta={delta(d.current.failed, d.previousStats.failed)}
            invert
          />
          <Kpi
            label="Catalogue coverage"
            value={pct(ratio(d.state.enriched, d.state.active), 0)}
            sub={`${count(d.state.enriched)} of ${count(d.state.active)} active`}
            highlight
          />
          <Kpi
            label="Fields filled"
            value={pct(d.state.fieldsFilled, 0)}
            sub={`${count(d.current.tokens)} tokens this period`}
          />
        </>
      )}
      extra={d => (
        <Section title="AI fields on active products">
          <div className="space-y-2">
            {Object.entries(d.state.fields).map(([k, v]) => {
              const share = ratio(v, d.state.active) ?? 0
              return (
                <div key={k} className="flex items-center gap-3 text-xs">
                  <span className="w-28 shrink-0 text-foreground-secondary">{FIELD_LABEL[k] ?? k}</span>
                  <div className="flex-1 h-2 bg-surface-secondary rounded-full overflow-hidden">
                    <div className="h-full bg-accent-500 rounded-full" style={{ width: `${share * 100}%` }} />
                  </div>
                  <span className="w-12 text-right tabular-nums text-foreground">{pct(share, 0)}</span>
                </div>
              )
            })}
          </div>
        </Section>
      )}
    />
  )
}
