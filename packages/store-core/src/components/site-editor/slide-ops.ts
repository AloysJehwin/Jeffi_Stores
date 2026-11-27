import type { CodeNode } from '@jeffi/site-blocks'
import { withBreakpoint, breakpointTokens, type DesignOp } from '@jeffi/site-blocks/design'
import { classOps } from '@/lib/site/code/classes'
import { placeFree, unplaceFree, type FreeRect } from '@/lib/site/code/free'
import {
  DEFAULT_ASPECT,
  DESIGN_WIDTH,
  FRAME_CLIP,
  aspectClasses,
  aspectOf,
  classOf,
  dropCqw,
  forEachNode,
  frameClasses,
  isDataPart,
  isSlide,
  pxToCqw,
  ratioOf,
  setCqwFont,
  slideLayers,
  unframeClasses,
  type SlideBp,
} from '@/lib/site/code/slide'
import { insideData } from './nodes'

// Slides as design operations on a section's tree (lib/site/code/slide.ts): a normal code section made a slide (its
// direct children become free layers where they sit, its frame gets the aspect), another aspect, and back to a flow
// section. Each is one undoable list of operations, composed from the class helpers and free layers.

/** One layer's box at a breakpoint, in px of the section as the canvas measured it; `fontPx` is its computed font size. */
export interface LayerBox {
  x: number
  y: number
  width: number
  height: number
  fontPx?: number
}
/** The section measured at one breakpoint: its own size, and the layers' boxes by node id. */
export interface SlideMeasure {
  width: number
  height: number
  layers: Record<string, LayerBox>
}
export type SlideMeasures = Partial<Record<SlideBp, SlideMeasure>>

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const round1 = (n: number) => Math.round(n * 10) / 10

/**
 * A measured box as % of the frame it will have: the frame's height is its width at the aspect, so a box keeps its
 * place across the width and is held inside the frame. Height is kept only when asked (a live part's fixed box).
 */
export function rectFromBox(frameWidth: number, aspect: string, box: LayerBox, withHeight: boolean): FreeRect {
  const frameHeight = frameWidth / ratioOf(aspect)
  const width = clamp(round1((box.width / frameWidth) * 100), 1, 100)
  const height = withHeight ? clamp(round1((box.height / frameHeight) * 100), 1, 100) : undefined
  return {
    left: clamp(round1((box.x / frameWidth) * 100), 0, 100 - width),
    top: clamp(round1((box.y / frameHeight) * 100), 0, 100 - (height ?? 0)),
    width,
    ...(height !== undefined ? { height } : {}),
  }
}

/** Where a layer goes when nothing was measured for it: a column down the frame, in tree order. */
const stacked = (i: number, n: number, withHeight: boolean): FreeRect => {
  const slot = 88 / Math.max(1, n)
  return { left: 6, top: round1(6 + i * slot), width: 88, ...(withHeight ? { height: round1(slot * 0.9) } : {}) }
}

/** Operations that turn a flow code section into a slide. [] when it is one already or its root can't be styled. */
export function makeSlideOps(tree: CodeNode, measured: SlideMeasures = {}, aspect: string = DEFAULT_ASPECT): DesignOp[] {
  const root = classOf(tree)
  if (!tree.id || root === null || tree.t !== 'el' || isSlide(tree)) return []
  const ops = classOps(tree.id, root, frameClasses(root, aspect))
  const layers = slideLayers(tree)
  layers.forEach((layer, i) => {
    const cls = classOf(layer)
    if (!layer.id || cls === null || insideData(tree, layer.id)) return
    const data = isDataPart(layer)
    const at = (bp: SlideBp) => {
      const m = measured[bp]
      const box = m?.layers[layer.id!]
      return m && box ? { rect: rectFromBox(m.width, aspect, box, data), font: box.fontPx } : null
    }
    const lg = at('lg')
    const md = at('md')
    // The narrower measure stands in for a missing one, then a column down the frame.
    const rect = (own: ReturnType<typeof at>, other: ReturnType<typeof at>) => own?.rect ?? other?.rect ?? stacked(i, layers.length, data)
    // Desktop first, so Tablet's placement does not pin Desktop to the flow.
    let next = placeFree(cls, 'lg', rect(lg, md), 10)
    next = placeFree(next, 'md', rect(md, lg), 10)
    for (const [bp, m] of [['lg', lg], ['md', md]] as const) if (m?.font) next = setCqwFont(next, bp, pxToCqw(m.font, DESIGN_WIDTH[bp]))
    // A live part keeps to its box: what runs past it is clipped, never resized.
    if (data) next = withBreakpoint(next, 'md', [...breakpointTokens(next, 'md').filter(t => t !== FRAME_CLIP), FRAME_CLIP])
    ops.push(...classOps(layer.id, cls, next))
  })
  return ops
}

/** Operations that set a slide's aspect. [] when it is not a slide or already has it. */
export function slideAspectOps(tree: CodeNode, aspect: string): DesignOp[] {
  const root = classOf(tree)
  if (!tree.id || root === null || !isSlide(tree) || aspectOf(tree) === aspect) return []
  return classOps(tree.id, root, aspectClasses(root, aspect))
}

/**
 * Operations that turn a slide back into a flow section: the frame classes go, its layers are in the flow again at
 * every breakpoint (ids and words untouched), and words sized in container units are given Tailwind sizes.
 */
export function unslideOps(tree: CodeNode): DesignOp[] {
  const root = classOf(tree)
  if (!tree.id || root === null || !isSlide(tree)) return []
  const ops = classOps(tree.id, root, unframeClasses(root))
  const layers = new Set(slideLayers(tree).map(l => l.id))
  forEachNode(tree, n => {
    const cls = classOf(n)
    if (!n.id || cls === null || n === tree) return
    let next = cls
    if (layers.has(n.id)) for (const bp of ['base', 'md', 'lg'] as const) next = unplaceFree(next, bp)
    next = dropCqw(next)
    ops.push(...classOps(n.id, cls, next))
  })
  return ops
}
