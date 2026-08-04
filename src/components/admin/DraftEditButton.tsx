'use client'

import { useState } from 'react'
import DraftConfirmModal from '@/components/admin/DraftConfirmModal'

/**
 * Edit button that funnels editing through the draft system. Clicking it opens
 * DraftConfirmModal, which POSTs to /api/admin/{entity}/{id}/draft to create a
 * draft (or opens the existing one on 409), then routes to the entity edit page.
 * Used by draft-backed entities (brands, categories, …) so direct live-editing
 * is never possible.
 */
export default function DraftEditButton({
  entity,
  id,
  name,
  hasDraft,
  backUrl,
  className,
  label,
}: {
  entity: string
  id: string
  name: string
  hasDraft: boolean
  backUrl?: string
  className?: string
  label?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={className || 'flex-shrink-0 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg font-semibold text-sm transition-colors'}
      >
        {label || (hasDraft ? 'Edit Draft' : 'Edit')}
      </button>
      {open && (
        <DraftConfirmModal
          entity={entity}
          productId={id}
          productName={name}
          productSku={null}
          existingDraftId={hasDraft ? id : null}
          backUrl={backUrl}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
