'use client'

import { useEffect, useState } from 'react'
import { SkeletonRows } from '../_components/Skeleton'
import { Card } from '../_components/Card'
import { fmt, fmtDate } from '../_components/finance'

interface Doc { id: string; type: string; number: string; template: string; totals: { total: number }; pdf_url: string; view_url: string; price_inr: number; created_at: string }

export default function DocumentsClient() {
  const [docs, setDocs] = useState<Doc[] | null>(null)
  useEffect(() => { fetch('/api/ecom/svc/documents/documents?limit=100').then(r => r.json()).then(d => setDocs(d.items ?? [])).catch(() => setDocs([])) }, [])
  return (
    <Card>
      {docs === null ? <SkeletonRows rows={5} cols={4} /> : docs.length === 0 ? <p className="text-sm text-foreground-secondary">No documents yet. Render one with <code>POST /v1/documents/invoice</code> and it shows up here.</p> : (
        <div className="-m-6 overflow-x-auto"><table className="w-full text-sm min-w-[720px]"><thead className="org-sand text-foreground-secondary"><tr>{['When', 'Type', 'Number', 'Layout', 'Total', 'Charged', ''].map(h => <th key={h} className="px-6 py-2 text-left text-xs font-semibold">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-border-default">{docs.map(d => <tr key={d.id}><td className="px-6 py-2.5 whitespace-nowrap text-foreground-secondary">{fmtDate(d.created_at)}</td><td className="px-6 py-2.5 capitalize">{d.type.replace('_', ' ')}</td><td className="px-6 py-2.5 font-mono text-xs">{d.number}</td><td className="px-6 py-2.5 text-xs">{d.template}</td><td className="px-6 py-2.5 tabular-nums">{fmt(d.totals.total)}</td><td className="px-6 py-2.5 tabular-nums">{fmt(d.price_inr)}</td><td className="px-6 py-2.5 text-right text-xs space-x-3"><a href={d.view_url} target="_blank" rel="noreferrer" className="org-brown font-semibold hover:underline">View</a><a href={d.pdf_url} target="_blank" rel="noreferrer" className="org-brown font-semibold hover:underline">PDF</a></td></tr>)}</tbody></table></div>
      )}
    </Card>
  )
}
