import { isTagNode, type CodeNode } from '@jeffi/site-blocks'
import { findNode, type Breakpoint, type DesignOp } from '@jeffi/site-blocks/design'
import { classOps } from '@/lib/site/code/classes'
import { frameFor, freeAt, placeFree, restack, unplaceFree, type FreeLayer, type FreeRect } from '@/lib/site/code/free'
import { insideData } from './nodes'

// Free layers as design operations on a section's tree: placing an element (and readying its frame), moving it back
// into the flow, and restacking it among the section's other layers at a breakpoint.

/** A node's own classes when they are written out ('' for none); null when built from data or not an element. */
export function litClass(tree: CodeNode, id: string): string | null {
  const n = findNode(tree, id)?.node
  if (!n || !isTagNode(n) || n.ro) return null
  const c = n.props.className
  if (!c) return ''
  return c.k === 'lit' && typeof c.v === 'string' ? c.v : null
}

/** Whether an element may be placed freely: written-out classes, not the section itself, not drawn per data item. */
export const canFree = (tree: CodeNode, id: string) => id !== tree.id && litClass(tree, id) !== null && !insideData(tree, id)

/** Its placement at a breakpoint, or null in the flow. */
export function layerAt(tree: CodeNode, id: string, bp: Breakpoint): FreeLayer | null {
  const cls = litClass(tree, id)
  return cls === null ? null : freeAt(cls, bp)
}

/** The section's free layers at a breakpoint. */
export function layersAt(tree: CodeNode, bp: Breakpoint): { id: string; layer: FreeLayer }[] {
  const out: { id: string; layer: FreeLayer }[] = []
  const walk = (n: CodeNode) => {
    if (isTagNode(n) && n.id) {
      const layer = layerAt(tree, n.id, bp)
      if (layer) out.push({ id: n.id, layer })
    }
    const kids = n.t === 'el' || n.t === 'cmp' || n.t === 'frag' ? n.children : []
    const slots = n.t === 'cmp' && n.render ? [n.render.body] : n.t === 'cond' ? [n.then, ...(n.else ? [n.else] : [])] : n.t === 'each' ? [n.body] : []
    ;[...kids, ...slots].forEach(walk)
  }
  walk(tree)
  return out
}

/**
 * Places an element at a breakpoint (a new layer goes on top of the others), and readies its frame: `relative`, and
 * its height kept once the layer leaves the flow.
 */
export function placeOps(tree: CodeNode, id: string, bp: Breakpoint, rect: FreeRect, at: { z?: number; frame?: string | null; frameHeight?: number | null } = {}): DesignOp[] {
  const cls = litClass(tree, id)
  if (cls === null) return []
  const others = layersAt(tree, bp).filter(l => l.id !== id).map(l => l.layer.z)
  const z = at.z ?? freeAt(cls, bp)?.z ?? (others.length ? Math.min(50, Math.max(...others) + 10) : 10)
  const ops = classOps(id, cls, placeFree(cls, bp, rect, z))
  const fcls = at.frame && at.frame !== id ? litClass(tree, at.frame) : null
  if (at.frame && fcls !== null) ops.push(...classOps(at.frame, fcls, frameFor(fcls, bp, at.frameHeight ?? null)))
  return ops
}

export function unplaceOps(tree: CodeNode, id: string, bp: Breakpoint): DesignOp[] {
  const cls = litClass(tree, id)
  return cls === null ? [] : classOps(id, cls, unplaceFree(cls, bp))
}

export function restackOps(tree: CodeNode, id: string, bp: Breakpoint, dir: 'front' | 'back' | 'forward' | 'backward'): DesignOp[] {
  const layer = layerAt(tree, id, bp)
  if (!layer) return []
  const z = restack(layersAt(tree, bp).map(l => l.layer.z), layer.z, dir)
  return z === layer.z ? [] : placeOps(tree, id, bp, layer.rect, { z })
}
