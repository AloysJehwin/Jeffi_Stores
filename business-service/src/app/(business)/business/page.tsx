import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { bp } from '@/lib/shared/business-path'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { getPageSections, loadSectionData } from '@/lib/catalog/homepage-model'
import { rowAudience } from '@/lib/catalog/homepage-sections'
import { getWebSurface } from '@/lib/catalog/web-surface'
import { CartProvider } from '@/contexts/CartContext'
import BusinessHeader from '@/components/business/Header'
import BusinessPublicHeader from '@/components/business/PublicHeader'
import SectionRenderer from '@/components/visitor/home/SectionRenderer'
import Reveal from '@/components/visitor/home/Reveal'
import BusinessHomeProvider from '@/components/visitor/home/business/BusinessHomeProvider'
import { businessHomeQuery } from '@/components/visitor/home/business/business-home'
import BusinessLanding, { getBusinessAuthState } from './_components/BusinessLanding'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const identity = await getStoreIdentity()
  return {
    title: `For Businesses — ${identity.name}`,
    description: 'Bulk pricing, GST-compliant invoices, RFQ flow, and dedicated support for procurement teams.',
  }
}

export default async function BusinessHomePage({ searchParams }: { searchParams: Promise<{ layout?: string }> }) {
  const hdrs = await headers()
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? ''
  const authState = await getBusinessAuthState()
  const surface = await getWebSurface((await searchParams).layout)

  // The business homepage when one is published and the plan has it; otherwise the store's rows
  // come back, and the landing (or, for a signed-in business, the catalog) stands in.
  const sections = await getPageSections({ surface, page: 'home', audience: 'business' })
  if (!sections.some(s => rowAudience(s) === 'business')) {
    if (authState === 'approved') redirect(bp('/business/products', host))
    return <BusinessLanding host={host} authState={authState} />
  }

  const data = await loadSectionData(sections, { surface, page: 'home', audience: 'business' })
  const approved = authState === 'approved'
  const portal = approved ? 'business' : 'storefront'

  return (
    <CartProvider>
      <div className="bg-surface min-h-screen">
        {approved ? <BusinessHeader /> : <BusinessPublicHeader authState={authState} />}

        <main className="pt-16 lg:pt-20">
          <BusinessHomeProvider query={businessHomeQuery(sections)} approved={approved} host={host}>
            {sections.map((section, i) => {
              const rendered = (
                <SectionRenderer
                  key={section.id}
                  section={section}
                  rowIndex={sections.slice(0, i).filter(s => s.type === 'product_row').length}
                  data={data}
                  portal={portal}
                />
              )
              if (section.type === 'hero' || section.type === 'motion_hero') return rendered
              return (
                <Reveal key={section.id} disabled={i <= 1}>
                  {rendered}
                </Reveal>
              )
            })}
          </BusinessHomeProvider>
        </main>
      </div>
    </CartProvider>
  )
}
