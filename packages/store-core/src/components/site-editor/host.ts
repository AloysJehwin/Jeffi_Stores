import type { ReactNode } from 'react'
import type { Block, CodeNode, PageDoc, ThemeTokens } from '@jeffi/site-blocks'

// What a host (the admin Site Builder, the Showcase studio) gives the visual editor for one page. The editor never
// fetches on its own: loading, saving, the canvas address, picture uploads and publishing are the host's.

export type SaveResult = { ok: true; doc: PageDoc } | { ok: false; error: string }
export type AiResult<T> = ({ ok: true } & T) | { ok: false; error: string }
export type ElementAsk =
  | { kind: 'text'; action: 'rewrite' | 'shorten' | 'translate'; text: string; language?: string; context?: string }
  | { kind: 'picture'; subject: string; aspect?: string | null }

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
  /**
   * A classic block's own fields (admin: the forms editor's BlockInspector). Each change comes back as the whole block;
   * the editor keeps its props and visibility as an undoable step and the canvas redraws after the save.
   */
  renderBlockFields?(p: { block: Block; canWrite: boolean; onChange: (next: Block) => void }): ReactNode
  /** A classic block the page can't lose (its core block), so it can't be duplicated or removed. */
  blockLocked?(type: string): boolean
  /**
   * "Change with AI" on the selection (the section's root, or none, for the whole section): the section's new tree and
   * the ids it changed. The editor saves before asking; the host charges as its AI does.
   */
  changeWithAi?(p: { block: string; label: string; tree: CodeNode; ids: string[]; instruction: string }): Promise<AiResult<{ tree: CodeNode; changed: string[] }>>
  /** A line under the AI box: what a change costs here. */
  aiNote?: string
  /**
   * Cheap element actions that return values, not code: words rewritten, shortened or translated, or a picture for
   * an image slot (stock first, with its credit when it is one).
   */
  elementAi?(p: ElementAsk): Promise<AiResult<{ text?: string; url?: string; alt?: string | null; credit?: unknown }>>
  /**
   * "Convert to editable section": a classic content block (lib/site/convertible.ts) rewritten as a code section with
   * the same words, links and pictures. The editor saves first; nothing is saved here, and the editor puts the result
   * in place as an undoable change.
   */
  convertBlock?(block: Block): Promise<AiResult<{ block: Block }>>
  /** Publishes (the host confirms first). */
  publish?(): Promise<void>
  /** Back to the host's own editor (saved first), named by `closeLabel`. */
  onClose?(): void
  closeLabel?: string
  /** A classic block's name (code sections carry their own label). */
  blockLabel?(type: string): string
}
