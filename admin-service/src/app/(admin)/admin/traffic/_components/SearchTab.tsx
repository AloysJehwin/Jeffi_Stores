'use client'

import { Empty, Kpi, KpiGrid, Section, Table, change, count, pct, when, type Col } from '@/components/admin/channels/ui'
import type { SearchData, SearchTerm } from '@/lib/traffic/types'
import { Note, rateText, ratio } from './shared'

type ZeroTerm = SearchData['zeroTerms'][number]

export default function SearchTab({ data }: { data: SearchData }) {
  const c = data.current
  const p = data.previous
  if (!c.searches) return <Empty msg="No storefront searches in this period yet." />
  const d = (a: number | null, b: number | null) => (a == null || b == null || !b ? null : (a - b) / b)

  const termCols: Col<SearchTerm>[] = [
    { key: 'term', label: 'Term', sort: r => r.term, render: r => <span className="break-all">&quot;{r.term}&quot;</span> },
    { key: 'searches', label: 'Searches', num: true, sort: r => r.searches, render: r => count(r.searches) },
    { key: 'searchers', label: 'Searchers', num: true, sort: r => r.searchers, render: r => count(r.searchers) },
    { key: 'avg', label: 'Avg results', num: true, sort: r => r.avgResults, render: r => r.avgResults.toFixed(1) },
    { key: 'zero', label: 'Zero-result', num: true, sort: r => ratio(r.zeroResults, r.searches) ?? -1, render: r => rateText(r.zeroResults, r.searches, 0) },
    { key: 'clicked', label: 'Clicked', num: true, sort: r => ratio(r.clickedSearchers, r.signedInSearchers) ?? -1, render: r => (r.signedInSearchers ? `${r.clickedSearchers} / ${r.signedInSearchers}` : '-') },
    { key: 'ordered', label: 'Ordered', num: true, sort: r => ratio(r.orderedSearchers, r.signedInSearchers) ?? -1, render: r => (r.signedInSearchers ? `${r.orderedSearchers} / ${r.signedInSearchers}` : '-') },
  ]
  const zeroCols: Col<ZeroTerm>[] = [
    { key: 'term', label: 'Term', sort: r => r.term, render: r => <span className="break-all">&quot;{r.term}&quot;</span> },
    { key: 'searches', label: 'Searches', num: true, sort: r => r.searches, render: r => count(r.searches) },
    { key: 'last', label: 'Last searched', sort: r => r.lastSearched, render: r => when(r.lastSearched) },
  ]

  return (
    <div className="space-y-5">
      <KpiGrid>
        <Kpi label="Searches" value={count(c.searches)} delta={change(c.searches, p.searches)} />
        <Kpi label="Unique searchers" value={count(c.searchers)} delta={change(c.searchers, p.searchers)} />
        <Kpi
          label="Zero-result rate"
          value={pct(ratio(c.zeroResults, c.searches))}
          delta={d(ratio(c.zeroResults, c.searches), ratio(p.zeroResults, p.searches))}
          invert
          sub={`${count(c.zeroResults)} searches`}
        />
        <Kpi
          label="Search to purchase"
          value={pct(ratio(c.purchasers, c.signedInSearchers))}
          delta={d(ratio(c.purchasers, c.signedInSearchers), ratio(p.purchasers, p.signedInSearchers))}
          sub={`${count(c.purchasers)} of ${count(c.signedInSearchers)} signed-in searchers`}
          highlight
        />
      </KpiGrid>

      <Section title="Top search terms">
        <Table rows={data.terms} cols={termCols} rowKey={r => r.term} />
      </Section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <Section title="Zero-result terms: catalogue gaps">
          <Table rows={data.zeroTerms} cols={zeroCols} rowKey={r => r.term} empty="Every search found something" pageSize={10} />
        </Section>
        <Section title="Results shown, nothing clicked or bought">
          <Table
            rows={data.noEngagement}
            cols={termCols.filter(col => ['term', 'searches', 'avg', 'clicked'].includes(col.key))}
            rowKey={r => r.term}
            empty="No term with results went unclicked"
            pageSize={10}
          />
        </Section>
      </div>

      <Note>
        Clicks and purchases can only be linked for signed-in searchers: a click is a product view within 30 minutes of
        the search, a purchase an online order within a day.
      </Note>
    </div>
  )
}
