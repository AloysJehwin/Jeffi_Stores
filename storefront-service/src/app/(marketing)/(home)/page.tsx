import ReviewCouponPopup from '@/components/visitor/ReviewCouponPopup'
import HomeSections from '@/components/visitor/home/HomeSections'
import { buildHomeModel } from '@/lib/catalog/homepage-model'
import { verifyHomepagePreviewToken } from '@/lib/catalog/homepage-preview-token'
import { getEditableHomepage } from '@/lib/catalog/homepage-draft'
import { getWebSurface } from '@/lib/catalog/web-surface'

export const revalidate = 120

export default async function HomePage({ searchParams }: { searchParams: Promise<{ layout?: string; preview?: string }> }) {
  const params = await searchParams
  // Admin preview: a signed token names the draft to render (Settings → Homepage → Preview).
  const preview = await verifyHomepagePreviewToken(params.preview)
  const draft = preview ? await getEditableHomepage(preview.draftId) : null
  // Same model the app reads from GET /api/home; phones get the mobile web layout.
  const surface = await getWebSurface(params.layout, !!draft?.draft)
  const { sections, data } = await buildHomeModel({ surface, draft: draft?.draft ? draft : null })

  return (
    <div className="bg-surface">
      <HomeSections sections={sections} data={data} />
      <ReviewCouponPopup />
    </div>
  )
}
