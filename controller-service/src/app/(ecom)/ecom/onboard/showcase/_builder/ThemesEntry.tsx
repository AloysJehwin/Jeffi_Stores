import type { ReactNode } from 'react'
import { LayoutTemplate } from 'lucide-react'

// Where a Showcase can start from a ready-made theme instead of the AI. The themes come in a later step of this flow:
// pass them as children then; until there are any, this only says they are coming (nothing to pick yet).

export default function ThemesEntry({ children }: { children?: ReactNode }) {
  if (children) return <>{children}</>
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border-default px-4 py-3 text-sm">
      <LayoutTemplate className="h-5 w-5 shrink-0 text-foreground-muted" aria-hidden />
      <p className="text-foreground-secondary">
        <span className="font-semibold text-foreground">Ready-made themes</span> — coming in this flow
      </p>
    </div>
  )
}
