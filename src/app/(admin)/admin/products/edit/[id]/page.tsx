import { redirect, notFound } from 'next/navigation'
import { ap } from '@/lib/shared/admin-path'
import { getHost } from '@/lib/tenancy/get-host'
import { getAllCategories, getAllBrands, getProduct } from '@/lib/queries'
import { query, queryOne } from '@/lib/shared/db'
import ProductForm from '@/components/admin/ProductForm'
import { ChevronLeft } from 'lucide-react'
import { getAdminSession } from '@/lib/auth/admin-auth'
import MobileEditBlock from '@/components/admin/MobileEditBlock'
import { updateProduct } from './actions'

export default async function EditProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | undefined }>
}) {
  const { id } = await params
  const { back } = await searchParams
  const host = await getHost()
  const product = await getProduct(id).catch(err => {
    console.error('[product-edit] getProduct failed for', id, err)
    return null
  })

  if (!product) {
    notFound()
  }

  const categories = await getAllCategories()
  const brands = await getAllBrands()
  const backUrl = back && back.startsWith('/admin/products') ? back : '/admin/products'

  const batchSumRow = product.perishable
    ? await queryOne<{ total: string }>(
        `SELECT COALESCE(SUM(quantity_remaining), 0)::text AS total FROM product_batches WHERE product_id = $1`,
        [id]
      )
    : null
  const perishableBatchTotal = parseFloat(batchSumRow?.total ?? '0') || 0

  const serialCountRow = product.serialized
    ? await queryOne<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM product_serials WHERE product_id = $1 AND status = 'in_stock'`,
        [id]
      )
    : null
  const serializedStockTotal = serialCountRow?.total ?? 0

  const session = await getAdminSession()
  const { hasPlanScope } = await import('@/lib/auth/plan-gate')
  const hasInventory = await hasPlanScope(session?.role ?? '', session?.scopes ?? [], 'inventory:read')
  const hasReturns = await hasPlanScope(session?.role ?? '', session?.scopes ?? [], 'returns:read')

  const draftRow = await queryOne<{
    product_id: string
    fields: Record<string, unknown>
    variants: Record<string, unknown>[]
    sub_variants: Record<string, unknown>[]
    images: Record<string, unknown>[]
  }>(`SELECT product_id, fields, variants, sub_variants, images FROM product_drafts WHERE product_id = $1`, [id])
  const isDraft = !!draftRow
  // A create-draft product (is_draft = true) has no product_drafts row but must still render its
  // edit form (editing in place via the live-edit path) rather than bouncing to the detail page.
  const isCreateDraft = (product as { is_draft?: boolean })?.is_draft === true

  // Editing a LIVE product ALWAYS goes through a draft. Direct navigation to the edit URL for a
  // live product with no draft is blocked — redirect to the detail page, where the Edit button
  // creates a draft first. Create-drafts are the exception: they edit in place.
  if (!isDraft && !isCreateDraft) {
    const host = await getHost()
    redirect(ap(`/admin/products/${id}`, host))
  }

  // In draft mode, merge saved draft fields over the live product so the form
  // shows the admin's last saved changes (not the original live values).
  // Only use draft variants if they have both id and sku (autosaved from popup).
  const draftVariants =
    isDraft && Array.isArray(draftRow?.variants) && draftRow!.variants.some((v: any) => v.sku && v.id)
      ? draftRow!.variants
      : null

  // Distribute draft sub_variants onto their parent variant so the form's initial
  // render reflects DRAFT sub-variant edits (add/remove/rename), not just live. The
  // draft column is a complete per-variant snapshot (seeded at draft-entry), so any
  // variant with a draft row — including only _cleared sentinels — gets the draft's
  // (possibly empty) set; variants absent from the draft keep their live sub-variants.
  const draftSubVariants = isDraft && Array.isArray(draftRow?.sub_variants) ? draftRow!.sub_variants : []
  function withDraftSubVariants(variantList: any[]): any[] {
    if (draftSubVariants.length === 0) return variantList
    const byVariant = new Map<string, any[]>()
    for (const sv of draftSubVariants as any[]) {
      if (!sv.variant_id) continue
      const list = byVariant.get(sv.variant_id) || []
      if (!sv._cleared && sv.sub_variant_name) {
        const { _seeded, _edited, ...clean } = sv
        list.push(clean)
      }
      byVariant.set(sv.variant_id, list)
    }
    return (variantList || []).map((v: any) => (byVariant.has(v.id) ? { ...v, sub_variants: byVariant.get(v.id) } : v))
  }

  // getProduct now returns inactive variants/sub-variants too (the detail page needs them
  // for the status toggle). The draft editor treats inactive as soft-deleted, so keep only
  // active rows here and drop inactive sub-variants nested under an active variant.
  const liveActiveVariants = ((product as any)?.product_variants || [])
    .filter((v: any) => v?.is_active !== false)
    .map((v: any) => ({
      ...v,
      sub_variants: Array.isArray(v?.sub_variants)
        ? v.sub_variants.filter((sv: any) => sv?.is_active !== false)
        : v?.sub_variants,
    }))
  const mergedVariants = draftVariants
    ? withDraftSubVariants(draftVariants as any[])
    : withDraftSubVariants(liveActiveVariants)

  // Feed DRAFT images to the form so removals/reorders/primary changes persist across
  // reopen. The draft images carry their real `id` (kept at draft-entry + autosave),
  // which the ImageUpload widget needs for keep/remove. Fall back to live images only
  // if the draft somehow has none (older drafts created before ids were kept).
  const draftImages = isDraft && Array.isArray(draftRow?.images) ? draftRow!.images : []
  const draftImagesUsable = draftImages.length > 0 && draftImages.every((img: any) => img && img.id)
  const productForForm =
    isDraft && draftRow?.fields
      ? {
          ...product,
          ...draftRow.fields,
          product_variants: mergedVariants,
          ...(draftImagesUsable ? { product_images: draftImages } : {}),
        }
      : product

  // On-hand stock grains for the "assign existing stock" bootstrap. These MUST be
  // read from the LIVE product (getProduct), never from the draft merge above: the
  // draft's variant snapshot (autosaved from the form) has no inventory_quantity, so
  // deriving grains from productForForm would collapse every qty to 0 and hide the
  // bootstrap capture after the first autosave. Stock is intrinsic to the live
  // product and is not edited by the draft, so compute it here once.
  const liveStockGrains: {
    variant_id: string | null
    sub_variant_id: string | null
    label: string
    qty: number
    qty_step?: number
  }[] = []
  {
    const p: any = product
    if (p?.has_variants && Array.isArray(p?.product_variants)) {
      for (const v of p.product_variants) {
        if (v?.is_active === false) continue
        const subs = (Array.isArray(v?.sub_variants) ? v.sub_variants : []).filter((sv: any) => sv?.is_active !== false)
        if (subs.length > 0) {
          for (const sv of subs) {
            const qty = parseFloat(sv?.inventory_quantity) || 0
            if (qty > 0)
              liveStockGrains.push({
                variant_id: v.id,
                sub_variant_id: sv.id,
                label: `${v.variant_name} / ${sv.sub_variant_name}`,
                qty,
              })
          }
        } else {
          const qty = parseFloat(v?.inventory_quantity) || 0
          if (qty > 0) liveStockGrains.push({ variant_id: v.id, sub_variant_id: null, label: v.variant_name, qty })
        }
      }
    } else {
      const qty = parseFloat(p?.inventory_quantity ?? '0') || 0
      if (qty > 0) liveStockGrains.push({ variant_id: null, sub_variant_id: null, label: 'Product', qty })
    }
  }

  // Serial capture is one serial per qty_step of BASE quantity, matching the sale and
  // receive paths. Resolve each grain's step here so the form asks for the right count
  // instead of one field per base unit.
  if (liveStockGrains.length > 0) {
    const { resolveGrainUnit } = await import('@/lib/catalog/selling-unit')
    for (const g of liveStockGrains) {
      const u = await resolveGrainUnit(
        { query },
        {
          productId: id,
          variantId: g.variant_id,
          subVariantId: g.sub_variant_id,
        }
      )
      g.qty_step = u && u.qty_step > 0 ? u.qty_step : 1
    }
  }

  return (
    <MobileEditBlock>
    <div className="p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-6 text-sm">
        <a
          href={ap(backUrl, host)}
          className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Products
        </a>
        <span className="text-border-default">/</span>
        <span className="text-foreground font-medium">{isDraft ? 'Edit Draft' : 'Edit Product'}</span>
      </div>

      {isDraft && (
        <div className="mb-6 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-4 py-3">
          <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Draft pending</p>
          <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
            Edits are saved to draft. The live product stays unchanged until you publish.
          </p>
        </div>
      )}

      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-secondary-500 dark:text-foreground">
          {isDraft ? 'Edit Draft' : 'Edit Product'}
        </h1>
        <p className="text-foreground-secondary mt-1">
          {isDraft ? 'Changes are saved to the draft only' : 'Update product information'}
        </p>
      </div>

      <ProductForm
        categories={categories || []}
        brands={brands || []}
        product={productForForm}
        productId={id}
        action={updateProduct.bind(null, id)}
        backUrl={backUrl}
        perishableBatchTotal={perishableBatchTotal}
        serializedStockTotal={serializedStockTotal}
        isDraft={isDraft}
        liveStockGrains={liveStockGrains}
        initialBsEntries={(draftRow?.fields as any)?._bsEntries ?? null}
        hasInventory={hasInventory}
        hasReturns={hasReturns}
      />
    </div>
    </MobileEditBlock>
  )
}
