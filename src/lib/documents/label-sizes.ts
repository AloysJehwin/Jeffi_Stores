// Client-safe label size specs. Kept separate from label-pdf.ts (which requires
// pdfkit/qrcode/bwip-js via eval('require') and is server-only) so client
// components can import the size list without pulling the PDF toolchain into the
// browser bundle. label-pdf.ts re-exports these — one source of truth.

export type LabelSize = '30x20' | '30x50' | '40x60' | '50x50' | '80x20' | 'shelf-card'

export interface LabelSpec {
  size: LabelSize
  widthPt: number
  heightPt: number
  label: string
  widthMm: number
  heightMm: number
}

// Points per millimetre (PDF user-space units).
export const MM = 2.8346

export const LABEL_SIZES: LabelSpec[] = [
  { size: '30x20', widthMm: 30, heightMm: 20, widthPt: 30 * MM, heightPt: 20 * MM, label: '30×20 mm' },
  { size: '30x50', widthMm: 50, heightMm: 30, widthPt: 50 * MM, heightPt: 30 * MM, label: '30×50 mm' },
  { size: '40x60', widthMm: 60, heightMm: 40, widthPt: 60 * MM, heightPt: 40 * MM, label: '40×60 mm' },
  { size: '50x50', widthMm: 50, heightMm: 50, widthPt: 50 * MM, heightPt: 50 * MM, label: '50×50 mm' },
  { size: '80x20', widthMm: 80, heightMm: 20, widthPt: 80 * MM, heightPt: 20 * MM, label: '80×20 mm (Cable)' },
  {
    size: 'shelf-card',
    widthMm: 100,
    heightMm: 70,
    widthPt: 100 * MM,
    heightPt: 70 * MM,
    label: '100×70 mm (Shelf Card)',
  },
]

export function findLabelSpec(size: string | null | undefined): LabelSpec | undefined {
  return LABEL_SIZES.find(s => s.size === size)
}
