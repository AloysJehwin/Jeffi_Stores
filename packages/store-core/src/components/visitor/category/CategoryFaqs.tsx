import { queryMany } from '@/lib/shared/db'
import { faqJsonLd } from '@/components/visitor/pdp/ProductInfoSections'
import { ldJson } from '@/lib/catalog/listing-seo'

// Category page FAQ block (category_faqs, published, by sort_order) with FAQPage JSON-LD.

export type CategoryFaq = { id: string; question: string; answer: string }

export async function listCategoryFaqs(categoryId: string): Promise<CategoryFaq[]> {
  return queryMany<CategoryFaq>(
    `SELECT id, question, answer FROM category_faqs
      WHERE category_id = $1 AND published = true
      ORDER BY sort_order ASC, created_at ASC`,
    [categoryId]
  )
}

export function CategoryFaqs({ faqs }: { faqs: CategoryFaq[] }) {
  if (faqs.length === 0) return null
  return (
    <section className="mt-10 border-t border-border-default pt-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ldJson(faqJsonLd(faqs)) }} />
      <h2 className="text-xl font-bold text-foreground mb-3">Frequently asked questions</h2>
      <div className="max-w-3xl divide-y divide-border-default rounded-lg border border-border-default bg-surface-elevated">
        {faqs.map(f => (
          <details key={f.id} className="group px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-semibold text-foreground flex items-center justify-between gap-3">
              {f.question}
              <span aria-hidden className="text-foreground-muted transition-transform group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 whitespace-pre-line text-sm text-foreground-secondary">{f.answer}</p>
          </details>
        ))}
      </div>
    </section>
  )
}
