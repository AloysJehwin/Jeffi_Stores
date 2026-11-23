import type { ReactNode } from 'react'
import type { PageDoc, ThemeTokens } from '@jeffi/site-blocks'

// What a host (the admin Site Builder, the Showcase studio) gives the visual editor for one page. The editor never
// fetches on its own: loading, saving, the canvas address, picture uploads and publishing are the host's.

export type SaveResult = { ok: true; doc: PageDoc } | { ok: false; error: string }

export interface SiteEditorHost {
  /** Names what is being edited (the toolbar). */
  title: string
  /** The page, its code sections as v2 trees (lib/site/code/compile.ts upgradeCodeProps); null when it can't load. */
  load(): Promise<PageDoc | null>
  /**
   * Saves the page; the saved document comes back with the server's trees. Code sections go with an empty source, so
   * the server prints and compiles the tree (compileCodeProps).
   */
  save(doc: PageDoc): Promise<SaveResult>
  /** The canvas: the saved draft rendered with a preview token, or null while it isn't ready. */
  previewUrl: string | null
  canWrite: boolean
  /** The theme, for the style panel's colours and fonts. */
  theme?: ThemeTokens | null
  /** The host's own picture picker (its uploads, its library), reporting the chosen URL. */
  renderImagePicker?(p: { value: string; disabled: boolean; onPick: (url: string) => void }): ReactNode
  /** A classic block the page can't lose (its core block), so it can't be duplicated or removed. */
  blockLocked?(type: string): boolean
  /** Publishes (the host confirms first). */
  publish?(): Promise<void>
  /** Back to the host's own editor. */
  onClose?(): void
  /** A classic block's name (code sections carry their own label). */
  blockLabel?(type: string): string
}
