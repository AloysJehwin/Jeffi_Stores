'use client'

import { cloneElement, isValidElement, type ReactNode } from 'react'
import AIEnrichButton from './AIEnrichButton'
import type { AiActionScope } from '@/lib/auth/ai-scope'

interface Props {
  /** Label above the field. */
  label: ReactNode
  /** Matches the field element's id so the label is clickable. */
  htmlFor?: string
  /** Hint below the field. */
  hint?: ReactNode
  /** Error text below the field (shown in red). */
  error?: ReactNode
  /** Red asterisk on the label. */
  required?: boolean
  /** Column span, mirroring kit FormField. */
  span?: 1 | 2 | 3
  /** The raw <input> / <textarea> element. Caller owns its value/onChange. */
  field: ReactNode
  /** Click handler for the sparkle. Caller runs the AI call and mutates the field. */
  aiFill: () => void | Promise<void>
  /** Shows the spinner on the sparkle while true. */
  aiBusy?: boolean
  /** Scope for RequireAi gating. */
  aiFeature: AiActionScope
  /** 'in-field' (default) overlays the sparkle inside the field; 'above-label' pins it to the
   *  top-right of the label row. */
  placement?: 'in-field' | 'above-label'
  /** Textarea layout: sparkle sits at bottom-right. */
  multiline?: boolean
}

/** Clones the field element to append `pr-10`, leaving room for the in-field sparkle. */
function withSparkleRoom(node: ReactNode): ReactNode {
  if (!isValidElement<{ className?: string }>(node)) return node
  const existing = node.props.className ?? ''
  return cloneElement(node, { className: `${existing} pr-10`.trim() })
}

/** Kit-styled form field with an AI sparkle. Caller owns the field's state; `aiFill` is invoked
 *  on sparkle click and `aiBusy` toggles the spinner. Gated by `aiFeature` scope. */
export default function AdminFieldWithAI({
  label,
  htmlFor,
  hint,
  error,
  required,
  span,
  field,
  aiFill,
  aiBusy,
  aiFeature,
  placement = 'in-field',
  multiline,
}: Props) {
  const spanCls = span === 3 ? 'md:col-span-3' : span === 2 ? 'md:col-span-2' : ''
  const stubLabel = typeof label === 'string' ? label : ''

  if (placement === 'above-label') {
    return (
      <div className={`min-w-0 ${spanCls}`}>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label htmlFor={htmlFor} className="block text-xs font-medium text-foreground-secondary">
            {label}
            {required && <span className="ml-0.5 text-red-500">*</span>}
          </label>
          <AIEnrichButton
            fieldLabel={stubLabel}
            value=""
            onChange={() => {}}
            scope={aiFeature}
            placement="inline"
            aiBusy={aiBusy}
            aiFill={aiFill}
          />
        </div>
        {field}
        {hint && <p className="mt-1 text-xs text-foreground-muted">{hint}</p>}
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    )
  }

  const anchorCls = multiline ? 'absolute right-2 bottom-2' : 'absolute right-2 top-1/2 -translate-y-1/2'
  return (
    <div className={`min-w-0 ${spanCls}`}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-foreground-secondary">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      <div className="relative">
        {withSparkleRoom(field)}
        <AIEnrichButton
          fieldLabel={stubLabel}
          value=""
          onChange={() => {}}
          scope={aiFeature}
          placement="in-field"
          anchorClassName={anchorCls}
          aiBusy={aiBusy}
          aiFill={aiFill}
        />
      </div>
      {hint && <p className="mt-1 text-xs text-foreground-muted">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
