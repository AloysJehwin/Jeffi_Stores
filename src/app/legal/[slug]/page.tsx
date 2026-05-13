import { notFound } from 'next/navigation'
import Link from 'next/link'
import { getPolicyBySlug, policies } from '../policies'

export async function generateStaticParams() {
  return policies.map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const policy = getPolicyBySlug(slug)
  if (!policy) return {}
  return {
    title: `${policy.title} | Jeffi Stores`,
    description: policy.description,
  }
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const policy = getPolicyBySlug(slug)
  if (!policy) notFound()

  return (
    <div className="bg-surface min-h-screen">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10 md:py-16">

        <div className="mb-2">
          <Link href="/legal" className="text-xs text-accent-500 hover:text-accent-600 font-semibold inline-flex items-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Legal &amp; Policies
          </Link>
        </div>

        <div className="mb-8 md:mb-10">
          <p className="text-accent-500 text-xs font-bold uppercase tracking-widest mb-1">Legal</p>
          <h1 className="text-3xl md:text-4xl font-extrabold text-foreground">{policy.title}</h1>
          <p className="text-foreground-secondary mt-2 text-sm">{policy.description}</p>
          <p className="text-foreground-muted text-xs mt-2">Last updated: {policy.lastUpdated}</p>
        </div>

        <div className="space-y-8">
          {policy.sections.map((section, i) => (
            <div key={i} className="bg-surface-elevated rounded-xl border border-border-default p-6">
              <h2 className="text-base md:text-lg font-bold text-foreground mb-3">{section.heading}</h2>
              {Array.isArray(section.body) ? (
                <ul className="space-y-2">
                  {section.body.map((item, j) => (
                    <li key={j} className="flex gap-2 text-sm text-foreground-secondary leading-relaxed">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent-500 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-foreground-secondary leading-relaxed">{section.body}</p>
              )}
            </div>
          ))}
        </div>

        <div className="mt-10 pt-6 border-t border-border-default text-center">
          <p className="text-xs text-foreground-muted mb-3">Have questions about our policies?</p>
          <Link
            href="/support"
            className="inline-flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-6 py-2.5 rounded-lg font-semibold text-sm transition-colors"
          >
            Contact Support
          </Link>
        </div>

      </div>
    </div>
  )
}
