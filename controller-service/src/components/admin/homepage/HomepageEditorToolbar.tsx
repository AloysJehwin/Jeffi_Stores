'use client'

import EditorToolbar from '@/components/admin/EditorToolbar'
import { useEditSession } from '@/hooks/useEditSession'
import type { AutosaveStatus } from '@/hooks/useAutosaveDraft'

/**
 * Session-undo toolbar for the Homepage editor. The draft is singleton
 * (homepage_drafts.id = true), so we key the session by the admin's own uuid.
 * Cancel rolls the whole draft row back to its pre-session shape; Save is
 * hidden because Publish lives on HomepageDraftBar.
 */
export default function HomepageEditorToolbar({
  adminId,
  cancelHref,
}: {
  adminId: string
  cancelHref: string
}) {
  const edit = useEditSession({ resourceType: 'homepage', resourceId: adminId })
  if (!edit.sessionId) return null
  return (
    <div className="flex justify-end">
      <EditorToolbar
        autosaveStatus={'idle' as AutosaveStatus}
        sessionStatus={edit.status}
        onSave={async () => {
          await edit.save()
        }}
        onCancel={edit.cancel}
        cancelHref={cancelHref}
        hideSave
      />
    </div>
  )
}
