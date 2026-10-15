'use client'

import { useEffect, useState } from 'react'
import { FileText, Layers, Palette } from 'lucide-react'
import DesignsPanel from './DesignsPanel'
import BulkDocuments, { type Seller } from './BulkDocuments'
import { SkeletonRows } from '../_components/Skeleton'
import Pager, { useCursorPages } from '../_components/Pager'
import { Card } from '../_components/Card'
import { fmt, fmtDate } from '../_components/finance'

interface Doc { id: string; type: string; number: string; template: string; totals: { total: number }; pdf_url: string; view_url: string; price_inr: number; created_at: string }

type Tab = 'documents' | 'designs' | 'bulk'

export default function DocumentsClient(props: { seller: Seller | null; prices: Record<string, number>; balance: number }) {
  const [tab, setTab] = useState<Tab>('documents')
  useEffect(() => { const h = location.hash.slice(1); if (h === 'designs' || h === 'bulk') setTab(h) }, [])
  const pick = (t: Tab) => { setTab(t); history.replaceState(null, '', t === 'documents' ? location.pathname : `#${t}`) }
  return (
    <div className="space-y-6">
      <div role="tablist" className="inline-flex rounded-full org-sand p-1">
        {([['documents', 'Documents', FileText], ['designs', 'Designs', Palette], ['bulk', 'Bulk', Layers]] as const).map(([k, label, Icon]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => pick(k)}
            className={`inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-semibold transition-all ${tab === k ? 'bg-surface-elevated text-foreground shadow-sm' : 'text-foreground-secondary hover:text-foreground'}`}>
            <Icon className={`w-4 h-4 ${tab === k ? 'ecom-accent-text' : ''}`} /> {label}
          </button>
        ))}
      </div>
      {tab === 'documents' ? <DocumentList /> : tab === 'designs' ? <DesignsPanel seller={props.seller} prices={props.prices} /> : <BulkDocuments {...props} />}
    </div>
  )
}

function DocumentList() {
  const { items: docs, page, hasNext, go } = useCursorPages<Doc>('/api/ecom/svc/documents/documents')
  return (
    <>
    <Card>
      {docs === null ? <SkeletonRows rows={5} cols={4} /> : docs.length === 0 ? <p className="text-sm text-foreground-secondary">No documents yet. Render one with <code>POST /v1/documents/invoice</code> and it shows up here.</p> : (
        <div className="-m-6 overflow-x-auto"><table className="w-full text-sm min-w-[720px]"><thead className="org-sand text-foreground-secondary"><tr>{['When', 'Type', 'Number', 'Design', 'Total', 'Charged', ''].map(h => <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border-default">{docs.map(d => <tr key={d.id}><td className="px-6 py-2.5 whitespace-nowrap text-foreground-secondary">{fmtDate(d.created_at)}</td><td className="px-6 py-2.5 capitalize">{d.type.replace('_', ' ')}</td><td className="px-6 py-2.5 font-mono text-xs">{d.number}</td><td className="px-6 py-2.5 text-xs">{d.template}</td><td className="px-6 py-2.5 tabular-nums">{fmt(d.totals.total)}</td><td className="px-6 py-2.5 tabular-nums">{fmt(d.price_inr)}</td><td className="px-6 py-2.5 text-right text-xs space-x-3"><a href={d.view_url} target="_blank" rel="noreferrer" className="org-brown font-semibold hover:underline">View</a><a href={d.pdf_url} target="_blank" rel="noreferrer" className="org-brown font-semibold hover:underline">PDF</a></td></tr>)}</tbody></table></div>
      )}
    </Card>
    <Pager page={page} hasNext={hasNext} onPage={go} />
    </>
  )
}
