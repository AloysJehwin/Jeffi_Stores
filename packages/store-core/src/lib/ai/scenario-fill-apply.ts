// Applies a TemplateScenarioFill payload to the editor's field state and returns an UndoHandle
// that puts every field back where it was. The pre-fill snapshot is captured by the caller and
// handed in, so this file stays pure and SSR-safe (no fetch, no React, no editor-session HTTP).
// Server-side session bookkeeping (resnapshotSession / cancelSession) is a parent-level concern:
// the editor's own autosave carries the restored values back to the draft when the undo runs,
// and `options.sessionId` is kept here so a future wiring can call POST
// /api/admin/editor-sessions/{sessionId}/close with action='cancel' without changing this API.
import type { TemplateFillButton, TemplateScenarioFill } from './template-scenario.schema'

export interface EditorFieldSetters {
  setName: (v: string) => void
  setBody: (v: string) => void
  setPlaceholders: (v: string[]) => void
  setButtons: (v: TemplateFillButton[]) => void
  /** Email only. */
  setSubject?: (v: string) => void
  /** Email only. */
  setPreview?: (v: string) => void
  /** WhatsApp / email header image. `null` clears the field. */
  setImageUrl?: (v: string | null) => void
}

export interface EditorFieldSnapshot {
  name: string
  body: string
  placeholders: string[]
  buttons: TemplateFillButton[]
  subject?: string | null
  preview?: string | null
  image_url?: string | null
}

export interface UndoHandle {
  /** Restores every captured field to its pre-fill value via the same setters. */
  undo: () => void
  /** Opaque hint for a future server-side rollback (cancelSession); unused today. */
  sessionId: string | null
}

function writeValues(setters: EditorFieldSetters, snap: EditorFieldSnapshot): void {
  setters.setName(snap.name)
  setters.setBody(snap.body)
  setters.setPlaceholders(snap.placeholders)
  setters.setButtons(snap.buttons)
  if (setters.setSubject && snap.subject !== undefined) setters.setSubject(snap.subject ?? '')
  if (setters.setPreview && snap.preview !== undefined) setters.setPreview(snap.preview ?? '')
  if (setters.setImageUrl && snap.image_url !== undefined) setters.setImageUrl(snap.image_url ?? null)
}

/** Merge the AI fill into the editor's fields and return a one-shot undo that restores the pre-fill
 *  snapshot. Setters are called synchronously in a fixed order so the editor's internal autosave can
 *  batch them in one tick. */
export function applyScenarioFill(
  payload: TemplateScenarioFill,
  preFill: EditorFieldSnapshot,
  setters: EditorFieldSetters,
  options?: { sessionId?: string | null }
): UndoHandle {
  writeValues(setters, {
    name: payload.name,
    body: payload.body,
    placeholders: payload.placeholders,
    buttons: payload.buttons,
    subject: payload.subject ?? preFill.subject ?? null,
    preview: payload.preview ?? preFill.preview ?? null,
    image_url: payload.image_url ?? preFill.image_url ?? null,
  })
  return {
    sessionId: options?.sessionId ?? null,
    undo: () => writeValues(setters, preFill),
  }
}

/** Optional server-side rollback: POSTs cancel on the editor session so the draft row goes back to
 *  the snapshot. Called by the Undo path only when the caller wants a hard rollback rather than a
 *  pure setter-driven revert; a plain Undo without this stays entirely client-side. */
export async function cancelScenarioFillSession(sessionId: string): Promise<boolean> {
  try {
    const r = await fetch(`/api/admin/editor-sessions/${sessionId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'cancel' }),
    })
    return r.ok
  } catch (err) {
    console.warn('[scenario-fill] cancelScenarioFillSession failed:', err)
    return false
  }
}
