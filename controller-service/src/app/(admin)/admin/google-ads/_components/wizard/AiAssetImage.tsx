'use client'

import { useCanWrite } from '@/contexts/AdminScopesContext'
import AiMediaButton from '@/components/admin/ai/AiMediaButton'
import { AI_SIZE_PRESETS } from '@/lib/ai/media-features'
import type { WizardBootstrap } from '@/lib/google-ads/manage-data'

type WizardImage = WizardBootstrap['images'][number]

// AI image asset from the first picked product photo (or the first listed one). The result is
// added to that product's images so the campaign spec still references product_images ids,
// which is why it also needs products:write.
export function AiAssetImage({ images, selected, onAdd }: { images: WizardImage[]; selected: string[]; onAdd: (img: WizardImage) => void }) {
  const canEditProducts = useCanWrite('products')
  const base = images.find(i => i.id === selected[0]) ?? images[0]
  if (!canEditProducts || !base?.productId) return null
  return (
    <AiMediaButton
      feature="ads_image"
      compact
      label="AI image"
      sizes={[AI_SIZE_PRESETS.landscape, AI_SIZE_PRESETS.square, AI_SIZE_PRESETS.portrait]}
      defaultPrompt={`${base.productName} in a bright lifestyle setting, ad photo, no text`}
      referenceImageUrl={base.url}
      attachToProductId={base.productId}
      onPick={img => {
        if (img.productImageId) onAdd({ id: img.productImageId, productId: base.productId, productName: base.productName, url: img.url })
      }}
    />
  )
}
