// Shopper-facing product detail blocks: what's in the box, usage & care, Legal Metrology
// declarations and FAQs. Server-rendered; every block hides when empty.

interface Faq {
  id?: string
  question: string
  answer: string
}

const lines = (v?: string | null) =>
  (v ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  )
}

function Text({ v }: { v?: string | null }) {
  return <p className="whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">{v}</p>
}

export default function ProductInfoSections({ product, faqs = [] }: { product: Record<string, any>; faqs?: Faq[] }) {
  const p = product
  const box = lines(p.in_the_box)
  const legal: [string, string | null][] = [
    ['Manufacturer', [p.manufacturer_name, p.manufacturer_address].filter(Boolean).join(', ') || null],
    ['Packer', [p.packer_name, p.packer_address].filter(Boolean).join(', ') || null],
    ['Importer', [p.importer_name, p.importer_address].filter(Boolean).join(', ') || null],
    ['Net quantity', p.net_quantity != null ? `${Number(p.net_quantity)} ${p.net_quantity_unit ?? ''}`.trim() : null],
    ['Month & year of manufacture', p.mfg_month_year ?? null],
    ['Best before', p.best_before ?? null],
    ['Country of origin', p.country_of_origin ?? null],
    ['Consumer care', p.consumer_care ?? null],
  ]
  const legalShown = legal.filter(([, v]) => v)
  const hasUsage = box.length || p.usage_instructions || p.care_instructions || p.safety_warnings
  if (!hasUsage && legalShown.length === 0 && faqs.length === 0) return null

  return (
    <div className="bg-surface-elevated rounded-lg shadow-sm border border-border-default p-6 sm:p-8 mb-8 space-y-8">
      {hasUsage ? (
        <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {box.length > 0 && (
            <Block title="What's in the box">
              <ul className="list-disc space-y-1 pl-5 text-sm text-foreground-secondary">
                {box.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
            </Block>
          )}
          {p.usage_instructions && (
            <Block title="How to use">
              <Text v={p.usage_instructions} />
            </Block>
          )}
          {p.care_instructions && (
            <Block title="Care">
              <Text v={p.care_instructions} />
            </Block>
          )}
          {p.safety_warnings && (
            <Block title="Safety warnings">
              <Text v={p.safety_warnings} />
            </Block>
          )}
        </section>
      ) : null}

      {faqs.length > 0 && (
        <section>
          <h2 className="mb-3 text-xl font-bold text-foreground">Frequently asked questions</h2>
          <div className="divide-y divide-border-default rounded-lg border border-border-default">
            {faqs.map((f, i) => (
              <details key={f.id ?? i} className="group px-4 py-3">
                <summary className="cursor-pointer list-none text-sm font-medium text-foreground marker:hidden">
                  {f.question}
                </summary>
                <p className="mt-2 whitespace-pre-line text-sm text-foreground-secondary">{f.answer}</p>
              </details>
            ))}
          </div>
        </section>
      )}

      {legalShown.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold text-foreground">Legal disclosures</h3>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
            {legalShown.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-foreground-muted">{k}</dt>
                <dd className="text-foreground-secondary whitespace-pre-line">{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  )
}

/** FAQPage structured data for the visible FAQs. */
export function faqJsonLd(faqs: Faq[]) {
  if (faqs.length === 0) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map(f => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })),
  }
}
