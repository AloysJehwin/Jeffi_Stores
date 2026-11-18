import ReviewCouponPopup from '@/components/visitor/ReviewCouponPopup'
import HomeSections from '@/components/visitor/home/HomeSections'
import { buildHomeModel } from '@/lib/catalog/homepage-model'
import { previewRows } from '@/lib/site/preview'

export const revalidate = 120

export default async function HomePage({ searchParams }: { searchParams: Promise<{ layout?: string; preview?: string }> }) {
  const params = await searchParams
  // Admin preview: a signed token names the draft to render (a homepage draft, or a Site Builder draft whose blocks the
  // editor's canvas selects). Same model the app reads from GET /api/home; phones get the mobile web layout.
  const { surface, draft, selectable } = await previewRows(params.preview, params.layout)
  const { sections, data } = await buildHomeModel({ surface, draft })

  return (
    <div className="bg-surface">
      <HomeSections sections={sections} data={data} selectable={selectable} />
      <ReviewCouponPopup />
    </div>
  )
}
