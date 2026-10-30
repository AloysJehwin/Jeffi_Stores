'use client'

import { Check, AlertCircle } from 'lucide-react'
import { campaignVariables, variableUsed } from '@/lib/campaigns/kind-variables'
import { useToast } from '@/contexts/ToastContext'

/** The variables this campaign fills, with required ones flagged until the message uses them. */
export default function CampaignVariables({ kind, channel, text }: { kind: string; channel: 'email' | 'sms' | 'whatsapp'; text: string }) {
  const { showToast } = useToast()
  const vars = campaignVariables(kind, channel)
  const copy = (key: string) => {
    navigator.clipboard?.writeText(`{${key}}`).then(() => showToast(`Copied {${key}}`, 'success')).catch(() => {})
  }
  return (
    <div className="rounded-lg border border-border-default bg-surface-secondary/40 p-2.5 space-y-1.5">
      <p className="text-[11px] font-semibold text-foreground-secondary">
        This campaign fills <span className="font-normal text-foreground-muted">— click to copy; required ones must be in the message</span>
      </p>
      <div className="flex flex-wrap gap-1.5">
        {vars.map(v => {
          const used = variableUsed(text, v.key)
          const missing = v.required && !used
          return (
            <button
              key={v.key}
              type="button"
              title={`${v.label} — ${v.description}`}
              onClick={() => copy(v.key)}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-[11px] transition-colors ${
                missing
                  ? 'border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300'
                  : used
                    ? 'border-green-300 bg-green-50 text-green-700 dark:bg-green-900/20 dark:border-green-800 dark:text-green-300'
                    : 'border-border-secondary bg-surface text-foreground-secondary hover:bg-surface-secondary'
              }`}
            >
              {missing ? <AlertCircle className="w-3 h-3" /> : used ? <Check className="w-3 h-3" /> : null}
              {`{${v.key}}`}
              {v.required && <span className="font-sans text-[9px] uppercase opacity-70">required</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
