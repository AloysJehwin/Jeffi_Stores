'use client'

import { Rocket } from 'lucide-react'
import type { EcomPreset } from '@/lib/google-ads/ecom-presets'

// "Promote ecom": ready-made Search campaigns for the ecom site. Shown only when the server sent presets, which it does
// only on the flagship connected in platform mode. Picking one fills the wizard; the admin reviews it as usual.

export default function EcomPresets({ presets, onPick }: { presets: EcomPreset[]; onPick: (p: EcomPreset) => void }) {
  if (!presets.length) return null
  return (
    <section aria-label="Promote ecom" className="rounded-lg border border-accent-500/30 bg-accent-500/5 p-3 space-y-2">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Rocket className="w-4 h-4 text-accent-600" /> Promote ecom
      </p>
      <p className="text-xs text-foreground-muted">
        Search campaigns for the ecom site, with keywords, negatives and ad copy filled in. Review them, then check with Google and create.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {presets.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p)}
            className="rounded-lg border border-border-default bg-surface p-3 text-left hover:bg-surface-secondary"
          >
            <p className="text-sm font-medium text-foreground">{p.label}</p>
            <p className="text-xs text-foreground-muted mt-1">{p.blurb}</p>
            <p className="text-xs text-foreground-secondary mt-1">
              ₹{p.dailyBudget}/day · {p.keywords.length} keywords · India
            </p>
          </button>
        ))}
      </div>
    </section>
  )
}
