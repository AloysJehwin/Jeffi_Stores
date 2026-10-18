'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, Sparkles, Undo2, X } from 'lucide-react'
import { Dialog } from '@/components/admin/kit/dialog'
import AdminSelect from '@/components/admin/AdminSelect'
import Toggle from '@/components/ui/Toggle'
import ScenarioFillDiff from './ScenarioFillDiff'
import type { EditorFieldSnapshot, UndoHandle } from '@/lib/ai/scenario-fill-apply'
import type {
  TemplateChannel,
  TemplateImageAspect,
  TemplateMode,
  TemplateScenarioFill,
  TenantContext,
} from '@/lib/ai/template-scenario.schema'
import { CHANNEL_SUPPORTS_IMAGE } from '@/lib/ai/template-scenario.schema'

/** Server shape = TemplateScenarioFill. The endpoint may also return a priceInr for billing visibility
 *  (step 5 of the plan); when present the Apply button prints it. */
type ApiResponse = TemplateScenarioFill & { priceInr?: number }

interface Props {
  open: boolean
  onClose: () => void
  channel: TemplateChannel
  /** Initial mode select value. */
  templateMode: TemplateMode
  tenantContext: TenantContext
  /** Pre-fill snapshot of the editor's fields — drives the diff and the undo. */
  current: EditorFieldSnapshot
  /** Platform-library templates bill the platform tenant at internal pricing; store templates bill
   *  the caller tenant at public pricing. */
  isPlatformLibrary?: boolean
  /** Called with the generated payload when the admin clicks Apply. Return an UndoHandle to show the
   *  10-second Undo bar; return void to just dismiss. The caller is expected to wrap applyScenarioFill
   *  (which owns the setters and returns an UndoHandle). */
  applyFill: (payload: TemplateScenarioFill) => Promise<UndoHandle | void>
}

const MODE_OPTIONS = [
  { value: 'marketing', label: 'Marketing' },
  { value: 'utility', label: 'Utility' },
  { value: 'authentication', label: 'Authentication' },
  { value: 'transactional', label: 'Transactional' },
]

const ASPECT_OPTIONS = [
  { value: '1:1', label: '1:1 square' },
  { value: '16:9', label: '16:9 wide' },
  { value: '9:16', label: '9:16 tall' },
  { value: '4:5', label: '4:5 portrait' },
]

const PLACEHOLDER_BY_CHANNEL: Record<TemplateChannel, string> = {
  whatsapp: 'e.g. Welcome a new customer and share the first-order coupon FIRST10 with two quick-reply buttons.',
  sms: 'e.g. One-time login OTP — short, no buttons, no promotional claims.',
  email: 'e.g. Monthly newsletter: 3 new products, a seasonal offer, and a review request.',
}

const UNDO_WINDOW_MS = 10_000

const MIN_SCENARIO = 3
const MAX_SCENARIO = 500

/** Full "Fill from scenario" flow: form → preview → apply, with a floating Undo bar for 10 s after.
 *  The dialog never touches the editor's fields directly — the parent's `applyFill` wraps
 *  applyScenarioFill and returns the UndoHandle so the Undo bar can roll back. */
export default function ScenarioFillDialog({
  open,
  onClose,
  channel,
  templateMode: initialTemplateMode,
  tenantContext,
  current,
  isPlatformLibrary = false,
  applyFill,
}: Props) {
  const [scenarioText, setScenarioText] = useState('')
  const [templateMode, setTemplateMode] = useState<TemplateMode>(initialTemplateMode)
  const supportsImage = CHANNEL_SUPPORTS_IMAGE[channel]
  const [includeImage, setIncludeImage] = useState(false)
  const [imageAspect, setImageAspect] = useState<TemplateImageAspect>('1:1')
  const [phase, setPhase] = useState<'form' | 'preview'>('form')
  const [proposed, setProposed] = useState<ApiResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [undoHandle, setUndoHandle] = useState<UndoHandle | null>(null)

  // Re-seed the mode select when the parent opens the dialog on a different template.
  useEffect(() => {
    if (open) setTemplateMode(initialTemplateMode)
  }, [open, initialTemplateMode])

  const reset = () => {
    setScenarioText('')
    setIncludeImage(false)
    setImageAspect('1:1')
    setPhase('form')
    setProposed(null)
    setError(null)
    setBusy(false)
  }

  const handleClose = () => {
    if (busy) return
    reset()
    onClose()
  }

  const trimmed = scenarioText.trim()
  const canSubmit = trimmed.length >= MIN_SCENARIO && trimmed.length <= MAX_SCENARIO && !busy

  const handleGenerate = async () => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/admin/ai/template-scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel,
          scenarioText: trimmed,
          templateMode,
          tenantContext,
          includeImage: includeImage && supportsImage,
          imageAspect,
          isPlatformLibrary,
        }),
      })
      const body = (await r.json().catch(() => ({ error: 'invalid response' }))) as ApiResponse & { error?: string }
      if (!r.ok) throw new Error(body?.error || `HTTP ${r.status}`)
      setProposed(body)
      setPhase('preview')
    } catch (e) {
      setError((e as Error).message || 'Failed to generate')
    } finally {
      setBusy(false)
    }
  }

  const handleApply = async () => {
    if (!proposed || busy) return
    setBusy(true)
    setError(null)
    try {
      const maybe = await applyFill(proposed)
      reset()
      onClose()
      if (maybe && typeof maybe === 'object' && 'undo' in maybe) {
        setUndoHandle(maybe)
      }
    } catch (e) {
      setError((e as Error).message || 'Failed to apply')
      setBusy(false)
    }
  }

  const priceLabel = useMemo(() => {
    if (!proposed || proposed.priceInr == null) return null
    const n = Number(proposed.priceInr)
    if (!Number.isFinite(n)) return null
    return `₹${n.toFixed(2)}`
  }, [proposed])

  const applyLabel = priceLabel ? `Apply · ${priceLabel}` : 'Apply'

  const footer =
    phase === 'form' ? (
      <>
        <button
          type="button"
          onClick={handleClose}
          disabled={busy}
          className="control-md font-medium text-foreground-secondary hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canSubmit}
          className="control-md inline-flex items-center gap-1.5 bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Generate preview
        </button>
      </>
    ) : (
      <>
        <button
          type="button"
          onClick={() => {
            setPhase('form')
            setProposed(null)
            setError(null)
          }}
          disabled={busy}
          className="control-md font-medium text-foreground-secondary hover:text-foreground disabled:opacity-50"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={busy}
          className="control-md inline-flex items-center gap-1.5 bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {applyLabel}
        </button>
      </>
    )

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        size="lg"
        title="Fill from scenario"
        description="Describe what the template should accomplish — the AI drafts the whole thing, you review before anything lands in the editor."
        footer={footer}
      >
        {phase === 'form' ? (
          <div className="space-y-4">
            <div>
              <label htmlFor="scenario-text" className="mb-1.5 block text-xs font-medium text-foreground-secondary">
                Scenario
                <span className="ml-0.5 text-red-500">*</span>
              </label>
              <textarea
                id="scenario-text"
                value={scenarioText}
                onChange={e => setScenarioText(e.target.value.slice(0, MAX_SCENARIO))}
                rows={4}
                placeholder={PLACEHOLDER_BY_CHANNEL[channel]}
                className="field-md w-full border border-border-secondary bg-surface text-foreground placeholder:text-foreground-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent-500"
              />
              <div className="mt-1 flex items-center justify-between text-xs text-foreground-muted">
                <span>What the template should say — the AI handles the exact wording.</span>
                <span>
                  {trimmed.length}/{MAX_SCENARIO}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">Template type</label>
                <AdminSelect
                  md
                  value={templateMode}
                  onChange={v => setTemplateMode(v as TemplateMode)}
                  options={MODE_OPTIONS}
                />
              </div>
              {supportsImage && (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">Header image</label>
                  <div className="flex h-[32px] items-center">
                    <Toggle
                      checked={includeImage}
                      onChange={setIncludeImage}
                      label={includeImage ? 'Will be generated' : 'Text only'}
                    />
                  </div>
                </div>
              )}
              {supportsImage && includeImage && (
                <div className="sm:col-span-2">
                  <label className="mb-1.5 block text-xs font-medium text-foreground-secondary">Image aspect</label>
                  <AdminSelect
                    md
                    value={imageAspect}
                    onChange={v => setImageAspect(v as TemplateImageAspect)}
                    options={ASPECT_OPTIONS}
                  />
                </div>
              )}
            </div>

            {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        ) : (
          proposed && (
            <div className="space-y-3">
              <p className="text-xs text-foreground-muted">
                Review the draft against the current editor state. Apply overwrites every field — a 10-second Undo
                appears afterwards.
              </p>
              <ScenarioFillDiff channel={channel} current={current} proposed={proposed} />
              {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
            </div>
          )
        )}
      </Dialog>
      {undoHandle && (
        <ScenarioFillUndoBar
          handle={undoHandle}
          onDismiss={() => setUndoHandle(null)}
          windowMs={UNDO_WINDOW_MS}
        />
      )}
    </>
  )
}

interface UndoBarProps {
  handle: UndoHandle
  onDismiss: () => void
  windowMs?: number
}

/** Floating 'Scenario applied. Undo?' bar. Auto-dismisses after `windowMs`; clicking Undo invokes
 *  the handle and dismisses immediately. Lives in a portal so it survives the main dialog closing. */
export function ScenarioFillUndoBar({ handle, onDismiss, windowMs = UNDO_WINDOW_MS }: UndoBarProps) {
  const [mounted, setMounted] = useState(false)
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    setMounted(true)
    const t = setTimeout(() => dismissRef.current(), windowMs)
    return () => clearTimeout(t)
  }, [windowMs])

  if (!mounted || typeof document === 'undefined') return null

  const handleUndo = () => {
    try {
      handle.undo()
    } catch (err) {
      console.warn('[scenario-fill] undo failed:', err)
    }
    onDismiss()
  }

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="animate-fade-in-up fixed bottom-4 right-4 z-[9999] flex items-center gap-3 rounded-lg border border-border-default bg-surface-elevated px-4 py-2.5 shadow-lg"
    >
      <span className="text-sm font-medium text-foreground">Scenario applied.</span>
      <button
        type="button"
        onClick={handleUndo}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-accent-600 hover:bg-surface-secondary"
      >
        <Undo2 className="h-3.5 w-3.5" />
        Undo
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="control-sm control-icon -mr-1 text-foreground-muted hover:bg-surface-secondary hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </div>,
    document.body
  )
}
