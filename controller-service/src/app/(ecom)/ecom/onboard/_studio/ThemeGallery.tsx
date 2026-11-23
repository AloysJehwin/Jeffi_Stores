'use client'

import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowLeft, Check, Eye, Loader2, X } from 'lucide-react'
import { paletteFrom } from '@jeffi/site-blocks'
import { useToast } from '@/contexts/ToastContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import { THEME_PALETTES, THEME_STYLES, themeIdOf, themeName, themeOfDirection, themeStyle, themeTokens, type ThemeAvailable, type ThemePalette, type ThemeStyleId } from '@/lib/site/themes/catalog'
import { choiceCardCls } from '../../_ui'
import { ghostBtn, noteCls, primaryBtn, secondaryBtn } from '../ui'
import { StudioError, studioPost, studioProduct, studioUrl, type StudioView } from './api'
import StudioPreview, { DeviceToggle, usePreviewDevice } from './StudioPreview'
import { MiniUi, fontsLink, type MiniUiLook } from './StylePreview'

// Ready-made themes: five styles, five palettes each, every one a full site ready at once with the owner's details
// (lib/site/themes). Try one in the live preview before applying it; applying replaces the site (asked first when
// there is one) and uses no AI, so the free generation stays. Shared by the store's "Your site" step and the Showcase.

export type { ThemeAvailable }

/** Which styles are ready for this page's product (null when the server could not say). */
export async function fetchThemes(): Promise<ThemeAvailable | null> {
  const res = await fetch(studioUrl('theme'), { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return null
  const data = (await res.json().catch(() => null)) as { available?: ThemeAvailable } | null
  return data?.available ?? null
}

const FONTS = fontsLink([...new Set(THEME_STYLES.flatMap(s => themeStyle(s).fonts.flat()))])

/** The mini storefront in a theme's own colours: the fill its buttons wear (INK in themes/catalog.ts) and its page. */
function lookOf(style: ThemeStyleId, p: ThemePalette): MiniUiLook {
  const t = themeTokens(style, p)
  const pr = paletteFrom(p.primary)
  const n = paletteFrom(p.neutral)
  const bg = style === 'luxury' ? n[900] : style === 'brutalist' || style === 'glass' ? pr[50] : style === 'playful' ? paletteFrom(p.accent)[50] : '#ffffff'
  return {
    display: t.fontDisplay,
    body: t.fontBody,
    bg,
    ink: style === 'luxury' ? '#f5efe6' : n[900],
    primary: style === 'brutalist' ? p.primary : style === 'luxury' ? pr[300] : pr[700],
    accent: style === 'luxury' ? paletteFrom(p.accent)[300] : p.accent,
    radius: t.radius,
    buttonShape: t.buttonShape,
    buttonStyle: t.buttonStyle,
    cardStyle: t.cardStyle,
    shadow: t.shadow,
    headingCase: t.headingCase,
    headingTracking: t.headingTracking,
  }
}

function Swatch({ p }: { p: ThemePalette }) {
  return <span aria-hidden className="block h-7 w-7 rounded-full" style={{ background: `conic-gradient(${p.primary} 0 50%, ${p.accent} 50% 75%, ${p.neutral} 75% 100%)` }} />
}

function StyleCard({
  style,
  name,
  ready,
  current,
  palette,
  busy,
  onPalette,
  onPreview,
  onApply,
}: {
  style: ThemeStyleId
  name: string
  ready: boolean
  /** The palette the site wears now, when it is this style. */
  current: string | null
  palette: ThemePalette
  busy: boolean
  onPalette: (p: ThemePalette) => void
  onPreview: () => void
  onApply: () => void
}) {
  const st = themeStyle(style)
  const palettes = THEME_PALETTES[style]
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const at = palettes.indexOf(palette)
  const onKey = (e: KeyboardEvent) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (at + step + palettes.length) % palettes.length
    onPalette(palettes[next])
    refs.current[next]?.focus()
  }
  const wearing = current === palette.id
  return (
    <li className={`${choiceCardCls(!!current)} flex flex-col overflow-hidden bg-surface-elevated ${ready ? '' : 'opacity-70'}`}>
      <MiniUi look={lookOf(style, palette)} title={name} className="min-h-[8.5rem]" />
      <div className="flex-1 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-foreground">{st.name}</h4>
            <p className="text-xs text-foreground-secondary">{st.blurb}</p>
          </div>
          {!ready ? (
            <span className="shrink-0 rounded-full bg-surface-secondary px-2 py-0.5 text-[11px] font-medium text-foreground-muted">Coming soon</span>
          ) : current ? (
            <span className="shrink-0 rounded-full org-sage org-sage-text px-2 py-0.5 text-[11px] font-semibold">Your theme</span>
          ) : null}
        </div>
        <div role="radiogroup" aria-label={`${st.name} colours`} className="mt-3 flex flex-wrap gap-1.5" onKeyDown={onKey}>
          {palettes.map((p, i) => {
            const on = p.id === palette.id
            return (
              <button
                key={p.id}
                ref={el => {
                  refs.current[i] = el
                }}
                type="button"
                role="radio"
                aria-checked={on}
                aria-label={p.name}
                title={p.name}
                tabIndex={on ? 0 : -1}
                onClick={() => onPalette(p)}
                className={`ecom-focus rounded-full p-0.5 transition-shadow max-sm:p-1 ${on ? 'shadow-[0_0_0_2px_var(--sel-bg)]' : 'hover:shadow-[0_0_0_2px_var(--color-border-secondary)]'}`}
              >
                <Swatch p={p} />
              </button>
            )
          })}
        </div>
        <p className="mt-1.5 text-xs text-foreground-muted" aria-live="polite">
          {palette.name}
          {wearing ? ' · on your site now' : ''}
        </p>
      </div>
      <div className="flex border-t border-border-default">
        <button type="button" onClick={onPreview} disabled={!ready || busy} className="ecom-focus ecom-hover flex flex-1 items-center justify-center gap-1.5 px-2 py-3 text-xs font-semibold text-foreground-secondary hover:text-foreground disabled:opacity-40">
          <Eye className="h-3.5 w-3.5" /> Preview
        </button>
        <button type="button" onClick={onApply} disabled={!ready || busy || wearing} className="ecom-focus ecom-hover flex flex-1 items-center justify-center gap-1.5 border-l border-border-default px-2 py-3 text-xs font-semibold text-foreground hover:text-foreground disabled:opacity-40">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Use this theme
        </button>
      </div>
    </li>
  )
}

export default function ThemeGallery({
  name,
  view,
  available,
  onView,
  onApplied,
  onCancel,
}: {
  /** The store's (or business's) name, on the mini previews. */
  name: string
  view: StudioView | null
  available: ThemeAvailable | null
  /** The studio was opened (a preview needs a session). */
  onView: (v: StudioView) => void
  /** The theme is the site now. */
  onApplied: (v: StudioView, theme: string) => void
  /** Back to the site (when there is one). */
  onCancel?: () => void
}) {
  const { showToast } = useToast()
  const confirm = useConfirm()
  const s = view?.session ?? null
  const wearing = themeOfDirection(s?.direction)
  const hasSite = !!s && Object.keys(s.pages ?? {}).length > 0
  const home = studioProduct() === 'showcase' ? SHOWCASE_PAGE_KEY : 'store:home'
  const [picked, setPicked] = useState<Record<string, ThemePalette>>(() => (wearing ? { [wearing.style]: wearing.palette } : {}))
  const [busy, setBusy] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ style: ThemeStyleId; palette: ThemePalette; sessionId: string } | null>(null)
  const [page, setPage] = useState(home)
  const [device, setDevice] = usePreviewDevice()
  const top = useRef<HTMLDivElement>(null)
  const paletteOf = (style: ThemeStyleId) => picked[style] ?? THEME_PALETTES[style][0]
  const ready = (style: ThemeStyleId) => !!available?.[style]
  const anyReady = useMemo(() => THEME_STYLES.some(st => !!available?.[st]), [available])

  async function sessionId(): Promise<string | null> {
    if (s) return s.id
    setBusy('open')
    try {
      const v = await studioPost<StudioView>('theme', { action: 'open' })
      onView(v)
      return v.session?.id ?? null
    } catch (e) {
      showToast((e as Error).message, 'error')
      return null
    } finally {
      setBusy(null)
    }
  }

  async function tryOn(style: ThemeStyleId) {
    const id = await sessionId()
    if (!id) return
    setPage(home)
    setPreview({ style, palette: paletteOf(style), sessionId: id })
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function choose(style: ThemeStyleId, palette: ThemePalette, replace = hasSite) {
    const label = themeName(style, palette)
    if (
      replace &&
      !(await confirm({
        title: `Use the ${label} theme?`,
        message: 'It replaces the pages you have now, along with any changes made to them. Your free AI generation stays available.',
        confirmLabel: 'Use this theme',
        variant: 'danger',
      }))
    )
      return
    const id = themeIdOf(style, palette.id)
    setBusy(id)
    try {
      const v = await studioPost<StudioView>('theme', { action: 'apply', theme: id, replace })
      setPreview(null)
      onApplied(v, label)
    } catch (e) {
      // A site made meanwhile (another tab): ask, then replace it.
      if (e instanceof StudioError && e.code === 'has_site' && !replace) {
        setBusy(null)
        await choose(style, palette, true)
        return
      }
      showToast((e as Error).message, 'error')
    } finally {
      setBusy(null)
    }
  }

  const previewId = preview ? themeIdOf(preview.style, preview.palette.id) : null

  return (
    <div ref={top} className="space-y-4">
      {FONTS && <link rel="stylesheet" href={FONTS} />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <h3 className="font-display text-xl font-black text-foreground">Pick a ready-made theme</h3>
          <p className="mt-1 text-sm text-foreground-secondary">
            Five styles, five colour palettes each. Your name, logo and contact details fill it in{studioProduct() === 'showcase' ? ', with your work and services' : ', with sample products until yours arrive'}. Then change anything: move sections, edit the words, or ask the AI. Free, and your free AI generation stays for later.
          </p>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} className={ghostBtn}>
            <ArrowLeft className="h-4 w-4" /> Back to your site
          </button>
        )}
      </div>

      {available && !anyReady && (
        <p className={`${noteCls} bg-surface-secondary/60 text-foreground-secondary`}>The themes are being prepared and will be here soon. Until then, design your site with AI or start from our standard pages.</p>
      )}

      {preview && previewId && (
        <div className="rounded-2xl border border-border-default bg-surface-elevated p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-foreground">{themeName(preview.style, preview.palette)}</div>
              <div className="text-xs text-foreground-secondary">A preview with your details. Click through it to see other pages.</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DeviceToggle value={device} onChange={setDevice} />
              <button type="button" onClick={() => choose(preview.style, preview.palette)} disabled={!!busy || (wearing?.style === preview.style && wearing.palette.id === preview.palette.id)} className={`${primaryBtn} px-4 py-2`}>
                {busy === previewId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Use this theme
              </button>
              <button type="button" onClick={() => setPreview(null)} aria-label="Close the preview" className="ecom-focus rounded-full p-2 text-foreground-muted ecom-hover hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <StudioPreview sessionId={preview.sessionId} page={page} device={device} version={0} query={{ theme: previewId }} onOpenPage={key => setPage(key)} />
          {page !== home && (
            <button type="button" onClick={() => setPage(home)} className={`${secondaryBtn} mt-3 px-4 py-2`}>
              <ArrowLeft className="h-4 w-4" /> Back to the home page
            </button>
          )}
        </div>
      )}

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Themes">
        {THEME_STYLES.map(style => (
          <StyleCard
            key={style}
            style={style}
            name={name}
            ready={ready(style)}
            current={wearing?.style === style ? wearing.palette.id : null}
            palette={paletteOf(style)}
            busy={!!busy}
            onPalette={p => {
              setPicked(x => ({ ...x, [style]: p }))
              if (preview?.style === style) setPreview({ ...preview, palette: p })
            }}
            onPreview={() => void tryOn(style)}
            onApply={() => void choose(style, paletteOf(style))}
          />
        ))}
      </ul>
    </div>
  )
}
