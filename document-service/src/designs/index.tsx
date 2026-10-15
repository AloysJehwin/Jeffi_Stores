import { renderToBuffer } from '@react-pdf/renderer'
import type { DocumentType, RenderDocumentRequest } from '@jeffi/api-contracts'
import type { Totals } from '../totals.js'
import { buildModel, type Branding, type FontKey } from './model.js'
import { registerFonts, FONT_PAIRINGS, FONT_KEYS } from './fonts.js'
import { theme } from './kit.js'
import type { Design } from './types.js'
import { aurora } from './families/aurora.js'
import { ledger } from './families/ledger.js'
import { minimal } from './families/minimal.js'
import { block } from './families/block.js'
import { editorial } from './families/editorial.js'
import { grid } from './families/grid.js'
import { mono } from './families/mono.js'
import { corporate } from './families/corporate.js'
import { boutique } from './families/boutique.js'
import { compact } from './families/compact.js'

export const DESIGNS: Design[] = [aurora, ledger, minimal, block, editorial, grid, mono, corporate, boutique, compact]
const BY_KEY = new Map(DESIGNS.map(d => [d.key, d]))
// Layout keys from before the design families; existing API callers keep working.
const LEGACY: Record<string, { key: string; thermal?: boolean }> = {
  classic: { key: 'ledger' }, bold: { key: 'block' }, 'gst-detailed': { key: 'grid' }, 'thermal-80mm': { key: 'compact', thermal: true },
}
export const DEFAULT_DESIGN = 'aurora'

export function resolveDesign(key?: string | null): { design: Design; thermal: boolean } | null {
  if (!key) return { design: BY_KEY.get(DEFAULT_DESIGN)!, thermal: false }
  const legacy = LEGACY[key]
  const design = BY_KEY.get(legacy?.key ?? key)
  return design ? { design, thermal: !!legacy?.thermal } : null
}

export const isHexColor = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s)
export const isFontKey = (s: unknown): s is FontKey => typeof s === 'string' && (FONT_KEYS as string[]).includes(s)

export async function renderDocument(
  designKey: string | null | undefined, type: DocumentType, req: RenderDocumentRequest, totals: Totals, number: string, viewUrl: string, branding: Branding = {}
): Promise<Buffer> {
  registerFonts()
  const r = resolveDesign(designKey)
  if (!r) throw Object.assign(new Error(`Unknown design '${designKey}'`), { status: 400 })
  const { design, thermal } = r
  const t = theme(isHexColor(branding.accent) ? branding.accent : design.accent, isFontKey(branding.font) ? branding.font : design.font, design.palette)
  const m = await buildModel(type, req, totals, number, viewUrl, branding)
  return renderToBuffer(design.render(m, t, { thermal }))
}

export const designList = () => DESIGNS.map(d => ({ key: d.key, name: d.name, description: d.description, accent: d.accent, font: d.font }))
export const fontList = () => FONT_KEYS.map(k => ({ key: k, label: FONT_PAIRINGS[k].label }))
