'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import DraftConfirmModal from '@/components/admin/DraftConfirmModal'
import ProductStockMovements from '@/components/admin/ProductStockMovements'
import { ChangeLog } from '@/components/admin/change-log'
import { ap } from '@/lib/shared/admin-path'
import { useCanWrite, useHasScope } from '@/contexts/AdminScopesContext'
import { ErrorState, PageBody } from '@/components/admin/kit'
import { formatDate } from '@/lib/shared/format'
import { AiEnrichmentDialog, AiIntelligenceCard } from './_components/ai'
import { CollapsibleCard } from './_components/CollapsibleCard'
import { DetailSections, Specifications } from './_components/DetailSections'
import { PricingCard } from './_components/PricingCard'
import { ProductGallery } from './_components/ProductGallery'
import ProductMediaGallery from '@/components/media/ProductMediaGallery'
import { DocumentList } from '@/components/media/MediaItemView'
import { resolveMedia } from '@/lib/catalog/product-media-shared'
import { ProductHeader } from './_components/ProductHeader'
import ProductViewLoading from './_components/ProductViewLoading'
import { ShelfBadges } from './_components/ShelfBadges'
import { SupplierDetailsCard } from './_components/SupplierDetailsCard'
import { VariantsTable } from './_components/VariantsTable'
import { useBootstrapStockNotice, useProduct, useShelfStock, useStatusToggles } from './_components/hooks'
import type { HeldDraft } from './_components/product-view'

export default function ProductViewClient({
  id,
  hasInventory = true,
  heldDraft,
  draftsPanel,
}: {
  id: string
  hasInventory?: boolean
  /** Another admin holds the draft: open it read-only instead of starting one. */
  heldDraft?: HeldDraft | null
  /** Open drafts of this product (server-rendered EntityDrafts). */
  draftsPanel?: ReactNode
}) {
  const canWriteProducts = useCanWrite('products')
  const canEnrich = useHasScope('catalog_enrichment:read')
  const canShelving = useHasScope('shelving:read')
  const { product, loading, reload } = useProduct(id)
  const shelfStock = useShelfStock(id, canShelving)
  const status = useStatusToggles()
  const [aiOpen, setAiOpen] = useState(false)
  const [showDraftModal, setShowDraftModal] = useState(false)
  useBootstrapStockNotice(id)

  if (!loading && (!product || product.error)) {
    return (
      <PageBody>
        <ErrorState
          title="Product not found."
          actionNode={
            <Link href={ap('/admin/products')} className="text-sm text-accent-500 hover:underline">
              Back to Products
            </Link>
          }
        />
      </PageBody>
    )
  }

  if (loading || !product) return <ProductViewLoading />

  const p = product
  const images: any[] = p.product_images || []
  const variants: any[] = p.product_variants || []

  return (
    <PageBody>
      <ProductHeader p={p} heldDraft={heldDraft} canEnrich={canEnrich} onAi={() => setAiOpen(true)} onEdit={() => setShowDraftModal(true)} />
      {draftsPanel}
      {showDraftModal && (
        <DraftConfirmModal
          productId={p.id}
          productName={p.name}
          productSku={p.sku || null}
          existingDraftId={null}
          backUrl={`/admin/products/${p.id}`}
          onClose={() => setShowDraftModal(false)}
        />
      )}

      {/* Aside comes first in the markup so the image leads on a phone; it sits on the right from lg. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        <div className="min-w-0 space-y-4 lg:order-last">
          {/* product_media at product scope (every kind); the image tables are the fallback. */}
          <ProductMediaGallery
            items={resolveMedia(p.media ?? [])}
            ar
            emptyNode={<ProductGallery images={images} name={p.name} />}
          />
          <DocumentList items={resolveMedia(p.media ?? [])} />
          <PricingCard p={p} />
        </div>
        <div className="min-w-0 space-y-4 lg:col-span-2 xl:col-span-3">
          <DetailSections p={p} variants={variants} />
          {hasInventory && <SupplierDetailsCard productId={id} />}
          {p.specifications && Object.keys(p.specifications).length > 0 && <Specifications specs={p.specifications} />}
          {p.short_description && (
            <CollapsibleCard title="Short Description">
              <p className="text-sm leading-relaxed text-foreground">{p.short_description}</p>
            </CollapsibleCard>
          )}
          <AiIntelligenceCard p={p} />
          {shelfStock.length > 0 && (
            <CollapsibleCard title="Shelf Locations">
              <ShelfBadges rows={shelfStock} />
            </CollapsibleCard>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground-muted">
            <span>Created {formatDate(p.created_at)}</span>
            <span>Updated {formatDate(p.updated_at)}</span>
          </div>
        </div>
      </div>

      {p.has_variants && variants.length > 0 && (
        <VariantsTable productId={id} productActive={p.is_active} variants={variants} shelfStock={shelfStock} canWrite={canWriteProducts} status={status} />
      )}

      {aiOpen && (
        <AiEnrichmentDialog
          productId={id}
          onClose={() => setAiOpen(false)}
          onApproved={() => {
            setAiOpen(false)
            reload()
          }}
        />
      )}

      {hasInventory && <ProductStockMovements productId={id} />}
      <div className={hasInventory ? 'mt-3' : 'mt-6'}>
        <ChangeLog kind="product" id={id} variant="collapsible" preset="product" version={p.updated_at} />
      </div>
    </PageBody>
  )
}
