'use client'

import { Languages } from 'lucide-react'
import Select from '@/components/ui/Select'
import { SUPPORT_LANGUAGES } from '@/lib/support/types'

const OPTIONS = SUPPORT_LANGUAGES.map(l => ({ value: l.code, label: l.native, hint: l.native === l.label ? undefined : l.label }))

/** Compact language dropdown for a chat header (the app's own Select, not the native one). */
export default function LanguagePicker({ value, onChange, title = 'Chat language', tone = 'plain' }: { value: string | null; onChange: (lang: string) => void; title?: string; tone?: 'plain' | 'onPrimary' }) {
  const trigger =
    tone === 'onPrimary'
      ? 'text-white border-white/30 bg-white/10 hover:bg-white/20 [&_svg]:!text-white/80 [&_span]:!text-white'
      : 'text-foreground-secondary border-border-default bg-surface hover:bg-surface-secondary'
  return (
    <div className="relative" title={title}>
      <Languages className={`pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 z-[1] ${tone === 'onPrimary' ? 'text-white/90' : 'text-foreground-muted'}`} />
      <Select
        value={value ?? 'en'}
        onChange={onChange}
        options={OPTIONS}
        aria-label={title}
        triggerClassName={`h-8 pl-7 pr-2 rounded-lg border text-xs flex items-center justify-between gap-1 max-w-[9rem] focus:outline-none ${trigger}`}
      />
    </div>
  )
}
