'use client'

import { useEffect, useState } from 'react'
import { LayoutTemplate } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'
import { themeOfDirection, themeName } from '@/lib/site/themes/catalog'
import { Card } from '../../dashboard/_components/Card'
import { secondaryBtn } from '../ui'
import type { StudioView } from './api'
import ThemeGallery, { fetchThemes, type ThemeAvailable } from './ThemeGallery'

// A Showcase's ready-made themes (the builder's ThemesEntry): a line offering them, opening the gallery. Applying one
// makes the page at once, free; the AI studio below then shows it, to arrange, edit and change with AI.

export default function ShowcaseThemes({ name, view, onApplied }: { name: string; view: StudioView | null; onApplied: (v: StudioView) => void }) {
  const { showToast } = useToast()
  const [available, setAvailable] = useState<ThemeAvailable | null>(null)
  const [open, setOpen] = useState(false)
  const [own, setOwn] = useState<StudioView | null>(null)
  const current = own ?? view
  const wearing = themeOfDirection(current?.session?.direction)

  useEffect(() => {
    fetchThemes().then(setAvailable)
  }, [])

  // The studio's own state wins once it reports again.
  useEffect(() => setOwn(null), [view])

  if (!wearing && !(available && Object.keys(available).length)) return null

  if (!open)
    return (
      <div className="flex flex-col gap-3 rounded-2xl border border-border-default bg-surface-elevated px-4 py-3 sm:flex-row sm:items-center">
        <LayoutTemplate className="h-5 w-5 shrink-0 text-foreground-muted" aria-hidden />
        <p className="min-w-0 flex-1 text-sm text-foreground-secondary">
          {wearing ? (
            <>
              Your page wears the <span className="font-semibold text-foreground">{themeName(wearing.style, wearing.palette)}</span> theme.
            </>
          ) : (
            <>
              <span className="font-semibold text-foreground">Or start from a ready-made theme:</span> five styles in five colour palettes, ready at once with your details. Free, and your free AI design stays for later.
            </>
          )}
        </p>
        <button type="button" onClick={() => setOpen(true)} className={`${secondaryBtn} px-4 py-2 max-sm:w-full`}>
          {wearing ? 'Change theme' : 'Browse themes'}
        </button>
      </div>
    )

  return (
    <Card className="max-sm:px-4">
      <ThemeGallery
        name={name}
        view={current}
        available={available}
        onView={setOwn}
        onApplied={(v, label) => {
          setOwn(v)
          setOpen(false)
          onApplied(v)
          showToast(`Your page is ready in the ${label} theme. Change anything you like below.`, 'success')
        }}
        onCancel={() => setOpen(false)}
      />
    </Card>
  )
}
