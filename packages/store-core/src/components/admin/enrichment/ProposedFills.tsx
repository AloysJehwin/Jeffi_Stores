'use client'

import { ENRICH_CONTENT_FIELDS } from '@/lib/catalog/enrichment-fields'

type Fills = Partial<Record<(typeof ENRICH_CONTENT_FIELDS)[number]['key'], string | null>> & {
  faqs?: { question: string; answer: string }[] | null
}

/** Product fields an enrichment proposal will fill on approve (only those still empty on the product). */
export function ProposedFills({ item }: { item: Fills }) {
  const rows = ENRICH_CONTENT_FIELDS.filter(f => item[f.key])
  const faqs = item.faqs ?? []
  if (!rows.length && !faqs.length) return null
  return (
    <div className="md:col-span-2 space-y-3 rounded-md border border-border p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Fills empty product fields</p>
      {rows.map(f => (
        <div key={f.key}>
          <p className="mb-0.5 text-[11px] uppercase tracking-wide text-foreground-muted">{f.label}</p>
          <p className="whitespace-pre-line text-xs text-foreground">{item[f.key]}</p>
        </div>
      ))}
      {faqs.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] uppercase tracking-wide text-foreground-muted">FAQs ({faqs.length}, added only if the product has none)</p>
          <ul className="space-y-1.5">
            {faqs.map(q => (
              <li key={q.question} className="text-xs">
                <p className="font-medium text-foreground">{q.question}</p>
                <p className="text-foreground-muted">{q.answer}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
