'use client'

import { MessageCircle } from 'lucide-react'
import AdminSelect from '@/components/admin/AdminSelect'
import {
  whatsAppTemplatesForKind,
  getWhatsAppTemplate,
  renderWhatsAppPreview,
} from '@/lib/templates/whatsapp-registry'

export interface WhatsAppTemplateValue {
  key: string | null // our registry key (resolved to a Twilio Content SID at send)
  variables: Record<string, string> // {"1": "...", "2": "..."}
  headerImageUrl: string
}

interface Props {
  kind: string
  value: WhatsAppTemplateValue
  onChange: (v: WhatsAppTemplateValue) => void
  /** Sample values for the preview (e.g. {firstName: 'Sample'}). */
  previewVars?: Record<string, string>
}

const inputCls =
  'w-full field-normal border border-border-secondary bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500'

export default function WhatsAppTemplateEditor({ kind, value, onChange }: Props) {
  const templates = whatsAppTemplatesForKind(kind)
  const selected = getWhatsAppTemplate(value.key)

  if (templates.length === 0) {
    return (
      <p className="text-xs text-foreground-muted">
        No approved WhatsApp templates are available for this campaign type yet.
      </p>
    )
  }

  const previewBody = selected ? renderWhatsAppPreview(selected, value.variables) : ''

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Editor */}
      <div className="space-y-3">
        <div>
          <label className="block text-[11px] font-medium text-foreground-muted mb-1">Template</label>
          <AdminSelect
            value={value.key ?? ''}
            onChange={key => {
              const def = getWhatsAppTemplate(key)
              // Reset variables/image to fit the newly chosen template.
              onChange({ key: key || null, variables: {}, headerImageUrl: def?.hasImageHeader ? value.headerImageUrl : '' })
            }}
            options={[
              { value: '', label: 'Select a WhatsApp template…' },
              ...templates.map(t => ({ value: t.key, label: t.label })),
            ]}
          />
          <p className="text-[10px] text-foreground-muted mt-1">
            WhatsApp templates are pre-approved by Meta. Pick one and fill its fields; apply for more in
            Twilio to grow this list.
          </p>
        </div>

        {selected && (
          <>
            {selected.hasImageHeader && (
              <div>
                <label className="block text-[11px] font-medium text-foreground-muted mb-1">Header image URL</label>
                <input
                  className={inputCls}
                  value={value.headerImageUrl}
                  onChange={e => onChange({ ...value, headerImageUrl: e.target.value })}
                  placeholder="https://…/image.jpg"
                />
              </div>
            )}
            {selected.slots.map(slot => (
              <div key={slot.index}>
                <label className="block text-[11px] font-medium text-foreground-muted mb-1">
                  {slot.label} <span className="text-foreground-muted/60">({`{{${slot.index}}}`})</span>
                </label>
                <input
                  className={inputCls}
                  value={value.variables[String(slot.index)] ?? ''}
                  onChange={e =>
                    onChange({ ...value, variables: { ...value.variables, [String(slot.index)]: e.target.value } })
                  }
                  placeholder={`e.g. {firstName} or a fixed value`}
                />
              </div>
            ))}
          </>
        )}
      </div>

      {/* Chat-bubble preview */}
      <div>
        <p className="text-[11px] font-medium text-foreground-muted mb-1">Preview</p>
        <div className="rounded-lg p-3 bg-[#e5ddd5] dark:bg-zinc-800 min-h-[120px]">
          {selected ? (
            <div className="max-w-[85%] rounded-lg rounded-tl-none bg-white dark:bg-zinc-700 shadow-sm overflow-hidden">
              {selected.hasImageHeader && value.headerImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={value.headerImageUrl} alt="" className="w-full max-h-40 object-cover" />
              )}
              <div className="px-3 py-2">
                <p className="text-[13px] text-zinc-900 dark:text-zinc-100 whitespace-pre-line leading-snug">
                  {previewBody}
                </p>
                <p className="text-[10px] text-zinc-400 mt-1 flex items-center justify-end gap-1">
                  <MessageCircle className="w-3 h-3" /> WhatsApp
                </p>
              </div>
            </div>
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Select a template to preview the message.</p>
          )}
        </div>
      </div>
    </div>
  )
}
