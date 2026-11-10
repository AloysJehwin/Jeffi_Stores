import { query, queryOne } from '@/lib/shared/db'
import { deleteProductImage } from '@/lib/shared/s3'
import { discardDraftFiles } from '@/lib/vault/files'
import { closeAfter, type DraftActor } from '@/lib/admin/draft-locks'
import { discardRefusal, discarded, refused, type DiscardResult } from '@/lib/admin/discard-rows'

// A session's snapshot belongs to the draft it was opened on; a new or discarded draft ends it.
export async function closeProductSessions(draftId: string) {
  try {
    await query(
      `UPDATE editor_sessions SET closed_at = now(), closed_reason = 'save'
        WHERE resource_type = 'product' AND resource_id = $1 AND closed_at IS NULL`,
      [draftId]
    )
  } catch (e) {
    console.error('[product-draft] closing edit sessions failed for', draftId, e)
  }
}

/** Discard the edit draft `draftId` of the product, or (no draftId) the never-published product itself. */
export async function discardProductDraft(actor: DraftActor, id: string, draftId: string | null): Promise<DiscardResult> {
  const denied = await discardRefusal(actor, 'product', draftId ?? id)
  if (denied) return denied
  // Clean up S3 files for variant images that were uploaded fresh into this draft
  // (staged, never applied to live). Live-image rows (real uuid ids) are left alone —
  // their files still back the live product.
  const draft = draftId
    ? await queryOne<{ variant_images: any[]; images: any[] }>(`SELECT variant_images, images FROM product_drafts WHERE id = $1`, [draftId])
    : null

  // Create-draft (is_draft=true, no product_drafts edit-draft): discarding means deleting the
  // product row itself, since it was never published to the live list.
  if (!draft) {
    const createDraft = await queryOne<{ id: string }>(`SELECT id FROM products WHERE id = $1 AND is_draft = true`, [id])
    if (createDraft) {
      await query(`DELETE FROM products WHERE id = $1 AND is_draft = true`, [id])
      await closeAfter(actor, 'product', id, 'discarded')
      return discarded
    }
    return refused(404, 'Draft not found')
  }

  const stagedVI = Array.isArray(draft?.variant_images) ? draft!.variant_images : []
  for (const vi of stagedVI) {
    if (vi?._staged && vi?.s3_key && String(vi.id).startsWith('draft-vi-')) {
      await deleteProductImage(vi.s3_key, vi.s3_thumbnail_key || '').catch(e =>
        console.error('[product-draft] staged variant image cleanup failed for', id, vi.s3_key, e)
      )
    }
  }
  const stagedImages = Array.isArray(draft?.images) ? draft!.images : []
  for (const img of stagedImages) {
    if (img?._staged && img?.s3_key && String(img.id).startsWith('draft-img-')) {
      await deleteProductImage(img.s3_key, img.s3_thumbnail_key || '').catch(e =>
        console.error('[product-draft] staged image cleanup failed for', id, img.s3_key, e)
      )
    }
  }
  await discardDraftFiles(draftId!)
  await query(`DELETE FROM product_drafts WHERE id = $1`, [draftId])
  await closeProductSessions(draftId!)
  await closeAfter(actor, 'product', draftId!, 'discarded')
  return discarded
}
